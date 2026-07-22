import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import { logAudit } from '../../utils/auditLogger';
import { withRetry } from '../../utils/retry';
import crypto from 'crypto';

export const getAllInvoices = async (req: AuthRequest, res: Response) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;

  // 1. Determine CompanyID - Strict resolution
  let effectiveCompanyId = queryCompanyId || user.company_id || (user as any).companyId;

  // If context is still missing, refresh user data from DB
  try {
    if (!effectiveCompanyId) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { company_id: true }
      });
      if (dbUser?.company_id) effectiveCompanyId = dbUser.company_id;
    }
  } catch (err) {}

  const rawInvoiceNos = (req.query.invoice_nos || req.query.invoiceNos || '') as string;

  // 2. Pagination & Filter Params
  const page = parseInt(req.query.page as string) || 1;
  const requestedLimit = parseInt(req.query.limit as string);
  
  // If we are in "Selection" mode (ids provided) OR the frontend requests a large batch (usually 100 for dropdowns), 
  // we expand the limit to 5000 to ensure the user sees all 200+ records in one view.
  let limit = requestedLimit || 10;
  if (rawInvoiceNos || requestedLimit === 100 || req.query.type === 'selection') {
    limit = 5000;
  }
  const skip = (page - 1) * limit;

  const search = (req.query.search as string || '').toLowerCase();
  let sortBy = req.query.sortBy as string;
  if (sortBy === 'created_at') sortBy = 'app_created_at';
  const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
  const status = req.query.status as string;
  const fromDate = req.query.fromDate as string;
  const toDate = req.query.toDate as string;

  try {
    // 2. Build Filter Clauses
    const baseWhere: any = { AND: [] };

    if (effectiveCompanyId) {
      baseWhere.AND.push({ company_id: String(effectiveCompanyId) });
    } else if (user && user.role !== 'super_admin') {
      baseWhere.AND.push({ id: -1 }); 
    }

    const customerId = (req.query.customer_id || req.query.customerId) as string;
    if (customerId) {
      baseWhere.AND.push({ customer_id: parseInt(customerId) });
    }

    // Search Filter
    if (search) {
      baseWhere.AND.push({
        OR: [
          { customer_name: { contains: search.toLowerCase() } },
          { customer_name: { contains: search.toUpperCase() } },
          { dc_no: { contains: search.toLowerCase() } },
          { dc_no: { contains: search.toUpperCase() } },
          ...(!isNaN(parseInt(search)) ? [{ invoice_no: parseInt(search) }] : [])
        ]
      });
    }

    // Date Range Filter
    if (fromDate || toDate) {
      const dateFilter: any = {};
      if (fromDate) dateFilter.gte = new Date(fromDate);
      if (toDate) {
        const endDay = new Date(toDate);
        endDay.setHours(23, 59, 59, 999);
        dateFilter.lte = endDay;
      }
      baseWhere.AND.push({ invoice_date: dateFilter });
    }


    // clone baseWhere for the filtered view (the list)
    const filteredWhere = JSON.parse(JSON.stringify(baseWhere));

    // Smart Status Filter (Only applied to the list, not the overall totals)
    if (status && status !== 'all') {
      const statusType = status.toLowerCase();
      
      const allInvoices = await prisma.legacyInvoice.findMany({
          where: baseWhere,
          select: { id: true, invoice_date: true, total: true, grand_total: true, paid_amount: true, status: true, sub_total: true, tax_total: true, bill_type: true }
      });

      let statusIds: number[] = [];
      if (statusType === 'pending') {
          const cutoffDate = new Date('2025-01-01T00:00:00.000Z');
          statusIds = allInvoices
              .filter(inv => {
                  const isWop = inv.bill_type === 'without_process' || String(inv.bill_type).toLowerCase().includes('without');
                  const taxable = isWop ? 0 : (inv.sub_total ?? (parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '')) || 0));
                  const taxVal  = isWop ? 0 : (inv.tax_total ?? (parseFloat(String(inv.tax_total || '0').replace(/[^\d.]/g, '')) || 0));
                  let grand = parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0;
                  if (grand <= 0 && taxable > 0) grand = taxable + taxVal;
                  const paid = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
                  
                  const isPending = (grand - paid) > 0.5 || inv.status === 'BILLED';
                  const isFrom2025 = inv.invoice_date && new Date(inv.invoice_date) >= cutoffDate;
                  
                  return isPending && isFrom2025;
              })
              .map(inv => inv.id);
      } else if (statusType === 'paid') {
          statusIds = allInvoices
              .filter(inv => {
                  if (inv.status === 'PAID' || inv.status === 'COMPLETED') return true;
                  const isWop = inv.bill_type === 'without_process' || String(inv.bill_type).toLowerCase().includes('without');
                  const taxable = isWop ? 0 : (inv.sub_total ?? (parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '')) || 0));
                  const taxVal  = isWop ? 0 : (inv.tax_total ?? (parseFloat(String(inv.tax_total || '0').replace(/[^\d.]/g, '')) || 0));
                  let grand = parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0;
                  if (grand <= 0 && taxable > 0) grand = taxable + taxVal;
                  const paid = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
                  return (grand - paid) <= 0.5;
              })
              .map(inv => inv.id);
      } else {
          filteredWhere.AND.push({ status: status.toUpperCase() });
      }

      if (statusType === 'pending' || statusType === 'paid') {
          filteredWhere.AND.push({ id: { in: statusIds } });
      }
    }

    // Type Filter (Only applied to the list)
    const type = req.query.type as string;
    if (type && type !== 'all') {
      const types = type.split(',').map(t => {
        if (t === 'WOP') return 'without_process';
        if (t === 'BOTH') return 'both';
        return 'with_process';
      });
      if (types.includes('with_process')) {
        filteredWhere.AND.push({ OR: [{ bill_type: { in: types } }, { bill_type: null }, { bill_type: '' }] });
      } else {
        filteredWhere.AND.push({ bill_type: { in: types } });
      }
    }

    // Party Type Filter
    const partyType = req.query.partyType as string;
    if (partyType && partyType !== 'all') {
      const partyWhereCondition = partyType === 'customer' ? {
        OR: [
          { party_type: 'customer' },
          { party_type: null },
          { party_type: '' }
        ]
      } : { party_type: partyType };

      const relatedInwards = await prisma.inwardEntry.findMany({
        where: partyWhereCondition,
        select: { id: true }
      });
      const inwardIds = relatedInwards.map(i => i.id);
      
      if (partyType === 'vendor') {
         filteredWhere.AND.push({ inward_id: { in: inwardIds } });
      } else if (partyType === 'customer') {
         filteredWhere.AND.push({
           OR: [
             { inward_id: { in: inwardIds } },
             { inward_id: null },
             { inward_id: '' }
           ]
         });
      }
    }

    // Specific Invoice Selection Filter (Strict ID selection)
    if (rawInvoiceNos) {
      const parts = rawInvoiceNos.split(',').map(n => n.trim()).filter(n => n !== '');
      const numericParts = parts.map(n => parseInt(n)).filter(n => !isNaN(n));
      
      const invoiceConditions = [
        { id: { in: numericParts } }
      ];

      // When specific invoices are requested (e.g. for a voucher view), we bypass the strict company filter
      // to ensure linked records are visible even if they have company_id mismatches (migrated data).
      filteredWhere.AND = filteredWhere.AND.filter((c: any) => !c.company_id);
      filteredWhere.AND.push({ OR: invoiceConditions });
    }

    // 4. Execute Queries
    const [invoices, totalCount, sums] = await Promise.all([
      prisma.legacyInvoice.findMany({
        where: filteredWhere,
        include: { customer: true },
        skip,
        take: limit,
        orderBy: sortBy ? { [sortBy]: sortOrder } : [{ invoice_date: 'desc' }, { id: 'desc' }]
      }),
      prisma.legacyInvoice.count({ where: filteredWhere }),
      // Sums use baseWhere so summary cards stay consistent (e.g. the 12.45 Cr total)
      prisma.legacyInvoice.findMany({
        where: baseWhere,
        select: { total: true, grand_total: true, paid_amount: true, invoice_date: true, sub_total: true, tax_total: true }
      })
    ]);

    // Compute aggregate totals from ALL matching records (all pages, not just current page)
    const aggregates = sums.reduce(
      (acc: any, inv: any) => {
        // Use Float columns if available, otherwise parse legacy String columns
        const isWop = inv.bill_type === 'without_process' || String(inv.bill_type).toLowerCase().includes('without');
        const taxable = isWop ? 0 : (inv.sub_total ?? (parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '')) || 0));
        const taxVal  = isWop ? 0 : (inv.tax_total ?? (parseFloat(String(inv.tax_total || '0').replace(/[^\d.]/g, '')) || 0));
        
        let grand = isWop ? 0 : (inv.grand_total_float ?? (parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0));
        
        // Fallback: If grand_total is zero but we have taxable total, reconstruct the grand total
        if (grand <= 0 && taxable > 0) {
            grand = taxable + taxVal;
        }

        const paid = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
        const tax = grand - taxable;
        const outstanding = grand - paid;

        let isCritical = 0;
        if (outstanding > 0.5 && inv.invoice_date) {
            const diff = Date.now() - new Date(inv.invoice_date).getTime();
            if (diff > 90 * 24 * 60 * 60 * 1000) isCritical = 1;
        }

        return {
          totalTaxable: acc.totalTaxable + taxable,
          totalGrand:   acc.totalGrand   + grand,
          totalPaid:    acc.totalPaid    + paid,
          totalTax:     acc.totalTax     + (tax > 0 ? tax : 0),
          totalOutstanding: acc.totalOutstanding + (outstanding > 0.1 ? outstanding : 0),
          criticalOverdue: acc.criticalOverdue + isCritical
        };
      },
      { totalTaxable: 0, totalGrand: 0, totalPaid: 0, totalTax: 0, totalOutstanding: 0, criticalOverdue: 0 }
    );

    const parsedInvoices = await Promise.all(invoices.map(async (inv: any) => {
      const base = { ...inv };
      const mapped = {
        ...base,
        id: inv.id.toString(),
        invoiceNumber: (inv.invoice_no && inv.invoice_no !== 0) ? inv.invoice_no.toString() : (inv.delivery_no ? inv.delivery_no.toString() : (inv.dc_no || inv.id.toString())),
        date: inv.invoice_date,
        dueDate: inv.due_date,
        customerId: inv.customer_id?.toString(),
        customerName: inv.customer_name || inv.customer?.customer_name || 'N/A',
        poNo: inv.po_no || '',
        poDate: inv.po_date,
        dcNo: inv.dc_no || '',
        dcDate: inv.dc_date,
        billType: inv.bill_type === 'with_process' ? 'With Process' :
          inv.bill_type === 'without_process' ? 'Without Process' :
            inv.bill_type === 'both' ? 'Both' : (inv.bill_type || 'With Process'),
        type: (inv.bill_type === 'with_process' ? 'INVOICE' :
          inv.bill_type === 'without_process' ? 'WOP' :
            inv.bill_type === 'both' ? 'BOTH' : 'INVOICE'),
        items: JSON.parse(inv.items_json || '[]'),
        subTotal: parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '')) || 0,
        grandTotal: parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0,
        paidAmount: parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0,
        discount: parseFloat(String(inv.discount || '0').replace(/[^\d.]/g, '')) || 0,
        gstin: inv.gstin || '',
        state: inv.state || '',
        status: inv.status || 'DRAFT',
        taxTotal: parseFloat(String(inv.tax_total || '0').replace(/[^\d.]/g, '')) || 0,
        taxRate: parseFloat(String(inv.tax_rate || '0').replace(/[^\d.]/g, '')) || 0,
        inwardId: inv.inward_id,
        inward_id: inv.inward_id,
        inwardNo: inv.inward_no,
        inward_no: inv.inward_no,
        gst1: inv.gst1,
        gst2: inv.gst2,
        igst: inv.igst,
        gst1_per: inv.gst1_per,
        gst2_per: inv.gst2_per,
        igst_per: inv.igst_per
      };

      if (rawInvoiceNos && mapped.inwardId) {
         try {
             const inward = await prisma.inwardEntry.findUnique({
                 where: { id: mapped.inwardId }
             });
             
             if (inward && inward.items_json) {
                 const inwardItems = JSON.parse(inward.items_json);

                 // Sum quantities from ALL OTHER invoices (exclude current invoice)
                 const otherInvoices = await prisma.legacyInvoice.findMany({
                     where: { inward_id: mapped.inwardId, id: { not: inv.id } }
                 });
                 
                 const billedByOthers: Record<string, number> = {};
                 otherInvoices.forEach(otherInv => {
                     const otherItems = JSON.parse(otherInv.items_json || '[]');
                     otherItems.forEach((oi: any) => {
                         const itemName = String(oi.description || oi.item_name || '').toLowerCase().trim();
                         if (!billedByOthers[itemName]) billedByOthers[itemName] = 0;
                         billedByOthers[itemName] += (Number(oi.quantity || 0) + Number(oi.wopQty || 0));
                     });
                 });

                 // Also track this invoice's OWN current quantities per item
                 const myOwnQty: Record<string, number> = {};
                 mapped.items.forEach((item: any) => {
                     const itemName = String(item.description || item.item_name || '').toLowerCase().trim();
                     myOwnQty[itemName] = (Number(item.quantity || 0) + Number(item.wopQty || 0));
                 });
                 
                 mapped.items = mapped.items.map((item: any) => {
                     const itemName = String(item.description || item.item_name || '').toLowerCase().trim();
                     const originalItem = inwardItems.find((ii: any) => String(ii.description || ii.item_name || '').toLowerCase().trim() === itemName);
                     
                     if (originalItem) {
                         const originalQty = Number(originalItem.quantity ?? originalItem.vendorWorkBalance ?? originalItem.billingBalance ?? originalItem.remainingQty ?? 0);
                         const alreadyBilledByOthers = billedByOthers[itemName] || 0;
                         const myCurrentQty = myOwnQty[itemName] || 0;
                         // maxQty = remaining_pool (inward total - other invoices) 
                         // The remaining_pool already includes our own qty since we excluded ourselves.
                         // We explicitly compute: (inward total - others) to get total space available to this invoice.
                         // This allows the user to increase from their current qty up to this max.
                         item.maxQty = Math.max(myCurrentQty, originalQty - alreadyBilledByOthers);
                     }
                     return item;
                 });
             }
         } catch (e) {
             console.error("Failed to calculate maxQty", e);
         }
      }
      return mapped;
    }));

    // Compute aggregate totals for the CURRENT PAGE only
    const pageAggregates = parsedInvoices.reduce(
        (acc: any, inv: any) => {
            return {
                totalTaxable: acc.totalTaxable + inv.subTotal,
                totalGrand: acc.totalGrand + inv.grandTotal,
                totalPaid: acc.totalPaid + inv.paidAmount,
                totalOutstanding: acc.totalOutstanding + (inv.grandTotal - inv.paidAmount)
            };
        },
        { totalTaxable: 0, totalGrand: 0, totalPaid: 0, totalOutstanding: 0 }
    );

    res.json({
      items: parsedInvoices,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      },
      aggregates,
      pageAggregates
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch invoices', detail: error.message });
  }
};

export const createInvoice = async (req: AuthRequest, res: Response) => {
  const {
    invoiceNumber, date, dueDate, customerId, customerName,
    address, subTotal, grandTotal, items, billType, inwardId, inward_no, company_id, companyId, notes,
    po_no, po_date, dc_no, dc_date, poNo, poDate, dcNo, dcDate, gstin, state, tax_rate, taxRate,
    vehicleNo, vehicle_no
  } = req.body;

  const finalTaxRate = parseFloat(String(tax_rate || taxRate || '18'));
  const finalSubTotal = parseFloat(String(subTotal || '0'));
  const finalGrandTotal = parseFloat(String(grandTotal || '0'));
  const finalTaxTotal = finalGrandTotal - finalSubTotal;

  // Ghost Trap: Block 0.00 invoices from background triggers
  // Exception: Allow 0.00 amount for "Without Process" (WOP) or "Both" (in case only WOP items are present)
  const isWOP = String(billType || '').toLowerCase().includes('without') || String(billType || '').toLowerCase() === 'both';
  if (!isWOP && (!finalGrandTotal || finalGrandTotal <= 0)) {
     return res.status(400).json({ 
        error: 'Cannot create an invoice with 0.00 amount. Please ensure prices and quantities are entered before saving.' 
     });
  }

  const isIntraState = (state || '').toLowerCase().replace(/[^a-z]/g, '') === 'tamilnadu';

  const user = req.user;
  const rawCompanyId = user?.company_id || company_id || companyId;
  const finalCompanyId = rawCompanyId ? String(rawCompanyId).toLowerCase() : null;

  try {
    // Ensure invoice and DC (delivery challan) generate in different series based on billType
    const isWOP = billType === 'Without Process'; // Pure DC/Challan
    const isWP = billType === 'With Process';    // Pure Invoice

    const invNo = (!isWOP && invoiceNumber) 
      ? parseInt(String(invoiceNumber).replace(/\D/g, '')) 
      : null;
      
    const delNo = (!isWP && req.body.challanNumber) 
      ? parseInt(String(req.body.challanNumber).replace(/\D/g, '')) 
      : null;


    if (invNo) {
      const existingInv = await (prisma as any).legacyInvoice.findFirst({
        where: { invoice_no: invNo, company_id: String(finalCompanyId || '').toLowerCase() }
      });
      if (existingInv) return res.status(400).json({ error: `Invoice Number ${invNo} already exists!` });
    }

    if (delNo) {
      const existingDel = await (prisma as any).legacyInvoice.findFirst({
        where: { delivery_no: delNo, company_id: String(finalCompanyId || '').toLowerCase() }
      });
      if (existingDel) return res.status(400).json({ error: `Delivery Challan Number ${delNo} already exists!` });
    }

    const invoiceData = {
      invoice_no: invNo,
      delivery_no: delNo,
      invoice_date: date ? new Date(date) : new Date(),
      due_date: dueDate ? new Date(dueDate) : null,
      customer_id: customerId ? parseInt(String(customerId)) : null,
      customer_name: customerName,
      address,
      total: String(subTotal || '0'),
      sub_total: finalSubTotal,
      grand_total: String(grandTotal || '0'),
      items_json: JSON.stringify(items || []),
      bill_type: billType === 'With Process' ? 'with_process' :
        billType === 'Without Process' ? 'without_process' :
          billType === 'Both' ? 'both' : billType,
      inward_id: inwardId ? String(inwardId) : null,
      company_id: String(finalCompanyId || '').toLowerCase(),
      status: 'BILLED',
      gstin: gstin || null,
      state: state || null,
      notes: notes || '',
      tax_total: finalTaxTotal,
      tax_rate: finalTaxRate,
      gst1: isIntraState ? String(finalTaxTotal / 2) : null,
      gst2: isIntraState ? String(finalTaxTotal / 2) : null,
      igst: !isIntraState ? String(finalTaxTotal) : null,
      gst1_per: isIntraState ? String(finalTaxRate / 2) : null,
      gst2_per: isIntraState ? String(finalTaxRate / 2) : null,
      igst_per: !isIntraState ? String(finalTaxRate) : null,
      po_no: po_no || poNo,
      po_date: (po_date || poDate) ? new Date(po_date || poDate) : null,
      dc_no: dc_no || dcNo,
      dc_date: (dc_date || dcDate) ? new Date(dc_date || dcDate) : null,
    };

    const invoice = await withRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // If we have an inwardId, fetch it first to get its actual number for the invoice record
        let actualInwardNo: number | null = null;
        if (inwardId) {
          const inward = await tx.inwardEntry.findUnique({ where: { id: String(inwardId) } });
          if (inward) {
            const matched = String(inward.inward_no || '').match(/\d+/);
            actualInwardNo = matched ? parseInt(matched[0]) : null;
          }
        }

        const newInvoice = await (tx as any).legacyInvoice.create({
          data: {
            ...invoiceData,
            inward_no: actualInwardNo || invNo // Use actual inward no if found, fallback to invoice no for legacy compatibility
          }
        });

        // Update Inward status if linked
        if (inwardId) {
          const entry = await tx.inwardEntry.findUnique({ where: { id: String(inwardId) } });
          if (entry) {
            const originalItems = JSON.parse(entry.items_json || '[]');
            const inwardIdStr = String(inwardId);
            
            const allInvoices = await tx.legacyInvoice.findMany({ where: { inward_id: inwardIdStr } });
            const allOutwards = await tx.outwardEntry.findMany({ where: { inward_id: inwardIdStr } });
            
            const billedMap = new Map<string, number>();
            const dispatchedMap = new Map<string, number>();

            allInvoices.forEach((inv: any) => {
              const invItems = JSON.parse(inv.items_json || '[]');
              invItems.forEach((ii: any) => {
                const iden = (ii.description || ii.item_name || '').toLowerCase();
                billedMap.set(iden, (billedMap.get(iden) || 0) + (parseFloat(ii.qty || ii.quantity || '0') + parseFloat(ii.wopQty || ii.wop_qty || '0')));
              });
            });

            allOutwards.forEach((ow: any) => {
              const owItems = JSON.parse(ow.items_json || '[]');
              owItems.forEach((oi: any) => {
                const iden = (oi.description || oi.item_name || '').toLowerCase();
                if (ow.party_type !== 'vendor') {
                  dispatchedMap.set(iden, (dispatchedMap.get(iden) || 0) + parseFloat(oi.quantity || oi.qty || '0'));
                }
              });
            });

            let allBilled = true;
            let allDispatched = true;

            originalItems.forEach((item: any) => {
               const iden = (item.description || item.item_name || '').toLowerCase();
               const itemBilled = billedMap.get(iden) || 0;
               const itemDispatched = dispatchedMap.get(iden) || 0;
               const original = parseFloat(item.quantity || item.qty || '0');
               if (itemBilled < original - 0.5) allBilled = false;
               if (itemDispatched < original - 0.5) allDispatched = false;
            });

            await tx.inwardEntry.update({
              where: { id: inwardIdStr },
              data: { status: (allBilled && allDispatched) ? 'completed' : 'pending' }
            });
          }
        }

        // --- CONSOLIDATED CHALLAN LOGIC ---
        if (inwardId) {
            const existingChallans = await tx.challan.findMany({
                where: { inward_id: String(inwardId) }
            });
            const existingChallan = existingChallans[0];
            
            const isWop = String(billType || '').toLowerCase().includes('without');
            const currentItems = (items || []).map((it: any) => ({
                description: it.description,
                quantity: isWop ? 0 : Number(it.quantity || 0),
                wopQty: isWop ? (Number(it.wopQty) || Number(it.quantity) || 0) : Number(it.wopQty || 0),
                unit: it.unit || 'pcs',
                hsnCode: it.hsnCode || ''
            }));

            if (existingChallan) {
                const oldItems = JSON.parse(existingChallan.items_json || '[]');
                await tx.challan.update({
                    where: { id: existingChallan.id },
                    data: {
                        items_json: JSON.stringify([...oldItems, ...currentItems]),
                        vehicle_no: vehicleNo || vehicle_no || existingChallan.vehicle_no || 'N/A'
                    }
                });

                // If the user explicitly provided a challanNumber, respect it and update the existing challan.
                // Otherwise, update the legacyInvoice's delivery_no to match the existing challan
                const matched = String(existingChallan.challan_no || '').match(/\d+/);
                const actualChallanNo = matched ? parseInt(matched[0]) : null;
                if (delNo) {
                    await tx.challan.update({
                        where: { id: existingChallan.id },
                        data: { challan_no: `DC-${delNo}` }
                    });
                } else if (actualChallanNo) {
                    await (tx as any).legacyInvoice.update({
                        where: { id: newInvoice.id },
                        data: { delivery_no: actualChallanNo }
                    });
                }
            } else {
                // Generate a new Delivery Challan regardless of billType
                const challanNumVal = delNo || invNo || newInvoice.id;
                await tx.challan.create({
                    data: {
                        id: `CHL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                        challan_no: `DC-${challanNumVal}`,
                        party_id: String(customerId || ''),
                        party_name: String(customerName || 'N/A'),
                        party_type: 'customer',
                        company_id: String(finalCompanyId || ''),
                        date: new Date(),
                        type: 'delivery',
                        bill_type: billType || 'Both',
                        status: 'dispatched',
                        items_json: JSON.stringify(currentItems),
                        vehicle_no: String(vehicleNo || vehicle_no || 'N/A'),
                        driver_name: 'N/A',
                        inward_id: String(inwardId),
                        inward_no: String(inward_no || dc_no || dcNo || 'N/A')
                    }
                });

                // Update the legacyInvoice's delivery_no to match the newly generated challan
                if (delNo) {
                    await (tx as any).legacyInvoice.update({
                        where: { id: newInvoice.id },
                        data: { delivery_no: delNo }
                    });
                }
            }
        }

        // --- LEDGER ENTRY LOGIC ---
        const entriesToCreate: any[] = [];
        const inward = inwardId ? await tx.inwardEntry.findUnique({ where: { id: String(inwardId) } }) : null;

        // 1. Logic for Vendor Invoices (Payables)
        if (inward && inward.party_type === 'vendor' && inward.vendor_id) {
          const vendLastEntry = await (tx.ledgerEntry as any).findFirst({
            where: {
              party_id: String(inward.vendor_id),
              company_id: finalCompanyId ? String(finalCompanyId) : undefined
            },
            orderBy: { created_at: 'desc' }
          });
          const vendLastBal = vendLastEntry ? (vendLastEntry.balance || 0) : 0;
          const vendLastNum = parseFloat(String(vendLastBal)) || 0;
          const vendNewBal = vendLastNum + finalGrandTotal;

          entriesToCreate.push({
            id: crypto.randomUUID(),
            party_id: String(inward.vendor_id),
            party_name: inward.vendor_name || 'Unknown Vendor',
            party_type: 'vendor',
            company_id: finalCompanyId ? String(finalCompanyId) : null,
            date: date ? new Date(date) : new Date(),
            vch_type: 'INVOICE',
            vch_no: String(newInvoice.invoice_no || newInvoice.id),
            type: 'credit',
            amount: finalGrandTotal,
            balance: vendNewBal,
            description: `Job Work Charge (Inward: ${inward.inward_no}): Invoice ${newInvoice.invoice_no || newInvoice.id}`,
            reference_id: String(newInvoice.id)
          });
        } 
        // 2. Logic for Customer Invoices (Receivables)
        else if (customerId && finalGrandTotal > 0) {
          const custLastEntry = await (tx.ledgerEntry as any).findFirst({
            where: {
              party_id: String(customerId),
              company_id: finalCompanyId ? String(finalCompanyId) : undefined
            },
            orderBy: { created_at: 'desc' }
          });
          const custLastBal = custLastEntry ? (custLastEntry.balance || 0) : 0;
          const custLastNum = parseFloat(String(custLastBal)) || 0;
          const custNewBal = custLastNum + finalGrandTotal;

          entriesToCreate.push({
            id: crypto.randomUUID(),
            party_id: String(customerId),
            party_name: customerName || 'Unknown Customer',
            party_type: 'customer',
            company_id: finalCompanyId ? String(finalCompanyId) : null,
            date: date ? new Date(date) : new Date(),
            vch_type: 'INVOICE',
            vch_no: String(newInvoice.invoice_no || newInvoice.id),
            type: 'debit',
            amount: finalGrandTotal,
            balance: custNewBal,
            description: `Sales Invoice: ${newInvoice.invoice_no || newInvoice.id}`,
            reference_id: String(newInvoice.id)
          });
        }

        for (const entryData of entriesToCreate) {
          await (tx.ledgerEntry as any).create({ data: entryData });
        }

        return newInvoice;
      }, {
        maxWait: 15000,
        timeout: 45000
      });
    }, 3, 2000);

    // Logging Audit
    await logAudit({
      action: 'CREATE',
      entity: 'Invoice',
      entity_id: String(invoice.id),
      user_id: user?.id || 'unknown',
      user_name: user?.name || 'Unknown User',
      company_id: finalCompanyId,
      details: { invoice_no: invoice.invoice_no, customer: customerName, amount: grandTotal }
    });

    res.status(201).json(invoice);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create invoice', detail: error.message });
  }
};

export const updateInvoice = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const {
    date, dueDate, customerId, customerName,
    address, subTotal, grandTotal, items, billType, inwardId, status, notes, gstin, state, tax_rate, taxRate
  } = req.body;

  const finalTaxRate = tax_rate || taxRate ? parseFloat(String(tax_rate || taxRate)) : undefined;
  const finalSubTotal = subTotal ? parseFloat(String(subTotal)) : undefined;
  const finalGrandTotal = grandTotal ? parseFloat(String(grandTotal)) : undefined;

  let taxUpdate: any = {};
  if (finalGrandTotal !== undefined && finalSubTotal !== undefined) {
    const finalTaxTotal = finalGrandTotal - finalSubTotal;
    const isIntraState = (state || '').toLowerCase().replace(/[^a-z]/g, '') === 'tamilnadu';
    const currentRate = finalTaxRate || 12;

    taxUpdate = {
      tax_total: finalTaxTotal,
      tax_rate: finalTaxRate,
      gst1: isIntraState ? String(finalTaxTotal / 2) : null,
      gst2: isIntraState ? String(finalTaxTotal / 2) : null,
      igst: !isIntraState ? String(finalTaxTotal) : null,
      gst1_per: isIntraState ? String(currentRate / 2) : null,
      gst2_per: isIntraState ? String(currentRate / 2) : null,
      igst_per: !isIntraState ? String(currentRate) : null,
    };
  }

  const user = req.user;
  const finalCompanyId = user?.company_id ? String(user.company_id).toLowerCase() : null;

  try {
    const invoiceIdNum = parseInt(String(id));

    const invoice = await withRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        const oldInvoice = await (tx as any).legacyInvoice.findUnique({
          where: { id: invoiceIdNum }
        });

        if (!oldInvoice) {
          throw new Error('Invoice not found');
        }

        // --- SERVER-SIDE INWARD QUANTITY VALIDATION ---
        const effectiveInwardIdForValidation = inwardId !== undefined ? inwardId : oldInvoice.inward_id;
        if (effectiveInwardIdForValidation && items && Array.isArray(items)) {
          const inwardForValidation = await tx.inwardEntry.findUnique({
            where: { id: String(effectiveInwardIdForValidation) }
          });
          if (inwardForValidation && inwardForValidation.items_json) {
            const inwardItemsForValidation = JSON.parse(inwardForValidation.items_json);
            // Get billed qty from all OTHER invoices (exclude current being updated)
            const otherInvsForValidation = await tx.legacyInvoice.findMany({
              where: { inward_id: String(effectiveInwardIdForValidation), id: { not: invoiceIdNum } }
            });
            const billedByOthersValidation: Record<string, number> = {};
            otherInvsForValidation.forEach((oi: any) => {
              const oiItems = JSON.parse(oi.items_json || '[]');
              oiItems.forEach((oiItem: any) => {
                const n = String(oiItem.description || oiItem.item_name || '').toLowerCase().trim();
                billedByOthersValidation[n] = (billedByOthersValidation[n] || 0) + (Number(oiItem.quantity || 0) + Number(oiItem.wopQty || 0));
              });
            });

            for (const newItem of items) {
              const itemName = String(newItem.description || newItem.item_name || '').toLowerCase().trim();
              const originalInwardItem = inwardItemsForValidation.find((ii: any) =>
                String(ii.description || ii.item_name || '').toLowerCase().trim() === itemName
              );
              if (originalInwardItem) {
                const originalQty = Number(originalInwardItem.quantity ?? originalInwardItem.vendorWorkBalance ?? originalInwardItem.billingBalance ?? 0);
                const alreadyBilledByOthers = billedByOthersValidation[itemName] || 0;
                const maxAllowed = originalQty - alreadyBilledByOthers;
                const newTotal = Number(newItem.quantity || 0) + Number(newItem.wopQty || 0);
                if (newTotal > maxAllowed + 0.5) {
                  throw new Error(`Quantity for "${newItem.description || itemName}" (${newTotal}) exceeds the maximum available balance (${maxAllowed}). Please reduce the quantity.`);
                }
              }
            }
          }
        }
        // --- END VALIDATION ---

        const updatedInvoice = await (tx as any).legacyInvoice.update({
          where: { id: invoiceIdNum },
          data: {
            invoice_date: date ? new Date(date) : undefined,
            due_date: dueDate ? new Date(dueDate) : undefined,
            customer_id: customerId ? parseInt(String(customerId)) : undefined,
            customer_name: customerName,
            address,
            total: subTotal ? String(subTotal) : undefined,
            sub_total: finalSubTotal !== undefined ? finalSubTotal : undefined,
            grand_total: grandTotal ? String(grandTotal) : undefined,
            items_json: items ? JSON.stringify(items) : undefined,
            bill_type: billType === 'With Process' ? 'with_process' :
              billType === 'Without Process' ? 'without_process' :
                billType === 'Both' ? 'both' : billType,
            inward_id: inwardId ? String(inwardId) : undefined,
            po_no: req.body.po_no || req.body.poNo,
            po_date: (req.body.po_date || req.body.poDate) ? new Date(req.body.po_date || req.body.poDate) : undefined,
            dc_no: req.body.dc_no || req.body.dcNo,
            dc_date: (req.body.dc_date || req.body.dcDate) ? new Date(req.body.dc_date || req.body.dcDate) : undefined,
            status: status?.toUpperCase(),
            gstin: gstin,
            state: state,
            notes: notes,
            ...taxUpdate
          }
        });

        // Smart Status Update for Inward if linked
        const effectiveInwardId = inwardId !== undefined ? inwardId : updatedInvoice.inward_id;
            // DUAL-COMPLETION STATUS UPDATE
            const inwardIdStr = String(effectiveInwardId);
            const allInvoices = await tx.legacyInvoice.findMany({ where: { inward_id: inwardIdStr } });
            const allOutwards = await tx.outwardEntry.findMany({ where: { inward_id: inwardIdStr } });
            
            const billedMap = new Map<string, number>();
            const dispatchedMap = new Map<string, number>();

            allInvoices.forEach((inv: any) => {
              const invItems = JSON.parse(inv.items_json || '[]');
              invItems.forEach((ii: any) => {
                const iden = (ii.description || ii.item_name || '').toLowerCase();
                billedMap.set(iden, (billedMap.get(iden) || 0) + (parseFloat(ii.qty || ii.quantity || '0') + parseFloat(ii.wopQty || ii.wop_qty || '0')));
              });
            });

            allOutwards.forEach((ow: any) => {
              const owItems = JSON.parse(ow.items_json || '[]');
              owItems.forEach((oi: any) => {
                const iden = (oi.description || oi.item_name || '').toLowerCase();
                if (ow.party_type !== 'vendor') {
                  dispatchedMap.set(iden, (dispatchedMap.get(iden) || 0) + parseFloat(oi.quantity || oi.qty || '0'));
                }
              });
            });

            let allBilled = true;
            let allDispatched = true;

            // Note: we need originalItems here. In updateInvoice, it might be missing if not fetched.
            const entry = await tx.inwardEntry.findUnique({ where: { id: inwardIdStr } });
            if (entry) {
              const originalItems = JSON.parse(entry.items_json || '[]');

              originalItems.forEach((item: any) => {
                 const iden = (item.description || item.item_name || '').toLowerCase();
                 const itemBilled = billedMap.get(iden) || 0;
                 const itemDispatched = dispatchedMap.get(iden) || 0;
                 const original = parseFloat(item.quantity || item.qty || '0');
                 if (itemBilled < original - 0.5) allBilled = false;
                 if (itemDispatched < original - 0.5) allDispatched = false;
              });

              await tx.inwardEntry.update({
                where: { id: inwardIdStr },
                data: { status: (allBilled && allDispatched) ? 'completed' : 'pending' }
              });
            }

        // --- UPDATE LEDGER ENTRIES FOR INVOICE ---
        await (tx.ledgerEntry as any).deleteMany({
          where: {
            reference_id: String(updatedInvoice.id),
            vch_type: 'INVOICE'
          }
        });

        const actualGrandTotal = finalGrandTotal !== undefined ? finalGrandTotal : parseFloat(String(updatedInvoice.grand_total || '0').replace(/[^\d.]/g, ''));
        const actualCustomerId = customerId !== undefined ? customerId : updatedInvoice.customer_id;
        const actualCustomerName = customerName !== undefined ? customerName : updatedInvoice.customer_name;
        const actualDate = date ? new Date(date) : updatedInvoice.invoice_date;

        const entriesToCreate: any[] = [];
        const inward = effectiveInwardId ? await tx.inwardEntry.findUnique({ where: { id: String(effectiveInwardId) } }) : null;

        // 1. Logic for Vendor Invoices (Payables)
        if (inward && inward.party_type === 'vendor' && inward.vendor_id) {
          const vendLastEntry = await (tx.ledgerEntry as any).findFirst({
            where: {
              party_id: String(inward.vendor_id),
              company_id: finalCompanyId ? String(finalCompanyId) : undefined
            },
            orderBy: { created_at: 'desc' }
          });
          const vendLastBal = vendLastEntry ? (vendLastEntry.balance || 0) : 0;
          const vendLastNum = parseFloat(String(vendLastBal)) || 0;
          const vendNewBal = vendLastNum + actualGrandTotal;

          entriesToCreate.push({
            id: crypto.randomUUID(),
            party_id: String(inward.vendor_id),
            party_name: inward.vendor_name || 'Unknown Vendor',
            party_type: 'vendor',
            company_id: finalCompanyId ? String(finalCompanyId) : null,
            date: actualDate ? new Date(actualDate) : new Date(),
            vch_type: 'INVOICE',
            vch_no: String(updatedInvoice.invoice_no || updatedInvoice.id),
            type: 'credit',
            amount: actualGrandTotal,
            balance: vendNewBal,
            description: `Job Work Charge (Updated) (Inward: ${inward.inward_no}): Invoice ${updatedInvoice.invoice_no || updatedInvoice.id}`,
            reference_id: String(updatedInvoice.id)
          });
        } 
        // 2. Logic for Customer Invoices (Receivables)
        else if (actualCustomerId && actualGrandTotal > 0) {
          const custLastEntry = await (tx.ledgerEntry as any).findFirst({
            where: {
              party_id: String(actualCustomerId),
              company_id: finalCompanyId ? String(finalCompanyId) : undefined
            },
            orderBy: { created_at: 'desc' }
          });
          const custLastBal = custLastEntry ? (custLastEntry.balance || 0) : 0;
          const custLastNum = parseFloat(String(custLastBal)) || 0;
          const custNewBal = custLastNum + actualGrandTotal;

          entriesToCreate.push({
            id: crypto.randomUUID(),
            party_id: String(actualCustomerId),
            party_name: actualCustomerName || 'Unknown Customer',
            party_type: 'customer',
            company_id: finalCompanyId ? String(finalCompanyId) : null,
            date: actualDate ? new Date(actualDate) : new Date(),
            vch_type: 'INVOICE',
            vch_no: String(updatedInvoice.invoice_no || updatedInvoice.id),
            type: 'debit',
            amount: actualGrandTotal,
            balance: custNewBal,
            description: `Sales Invoice (Updated): ${updatedInvoice.invoice_no || updatedInvoice.id}`,
            reference_id: String(updatedInvoice.id)
          });
        }

        for (const entryData of entriesToCreate) {
          await (tx.ledgerEntry as any).create({ data: entryData });
        }

        return updatedInvoice;
      }, {
        maxWait: 15000,
        timeout: 45000
      });
    }, 3, 2000);

    // Logging Audit
    await logAudit({
      action: 'UPDATE',
      entity: 'Invoice',
      entity_id: String(id),
      user_id: (req as any).user?.id || 'unknown',
      user_name: (req as any).user?.name || 'Unknown User',
      company_id: (req as any).user?.company_id,
      details: { invoice_no: invoice.invoice_no, status, grandTotal, date }
    });

    res.json(invoice);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update invoice', detail: error.message });
  }
};

export const deleteInvoice = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.$transaction(async (tx) => {
      // Delete any ledger entries for this invoice first
      await (tx.ledgerEntry as any).deleteMany({
        where: {
          reference_id: String(id),
          vch_type: 'INVOICE'
        }
      });

      // Delete the invoice itself
      await (tx as any).legacyInvoice.delete({
        where: { id: parseInt(String(id)) }
      });
    });

    // Logging Audit
    await logAudit({
      action: 'DELETE',
      entity: 'Invoice',
      entity_id: String(id),
      user_id: (req as any).user?.id || 'unknown',
      user_name: (req as any).user?.name || 'Unknown User',
      company_id: (req as any).user?.company_id,
    });

    res.json({ message: 'Invoice deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete invoice', detail: error.message });
  }
};

export const getNextNumbers = async (req: AuthRequest, res: Response) => {
  const user = req.user;
  const queryCompanyId = (req.query.companyId || req.query.company_id) as string;
  const companyId = (user?.company_id || (user as any)?.companyId) || queryCompanyId;

  if (!companyId) return res.status(400).json({ error: 'Company context required' });

  try {
    const lastInv = await (prisma as any).legacyInvoice.findFirst({
      where: { 
        company_id: String(companyId),
        invoice_no: { not: null }
      },
      orderBy: { invoice_no: 'desc' }
    });
    const lastDel = await (prisma as any).legacyInvoice.findFirst({
      where: { 
        company_id: String(companyId),
        delivery_no: { not: null }
      },
      orderBy: { delivery_no: 'desc' }
    });

    const company = await prisma.company.findUnique({
      where: { id: String(companyId) }
    });

    let configNextInvoice = 1;
    let configNextChallan = 1;

    if (company && company.invoice_settings) {
      try {
        const settings = JSON.parse(company.invoice_settings);
        if (settings.nextNumber) {
          configNextInvoice = parseInt(settings.nextNumber) || 1;
        }
        if (settings.nextChallanNumber) {
          configNextChallan = parseInt(settings.nextChallanNumber) || 1;
        }
      } catch (e) {
        // ignore JSON parsing errors
      }
    }

    const dbNextInvoice = (lastInv?.invoice_no || 0) + 1;
    const dbNextChallan = (lastDel?.delivery_no || 0) + 1;

    res.json({
      nextInvoice: Math.max(dbNextInvoice, configNextInvoice),
      nextChallan: Math.max(dbNextChallan, configNextChallan)
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get next numbers', detail: error.message });
  }
};

