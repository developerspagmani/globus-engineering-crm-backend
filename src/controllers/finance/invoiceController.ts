import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import { logAudit } from '../../utils/auditLogger';
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
  const status = req.query.status as string;
  const fromDate = req.query.fromDate as string;
  const toDate = req.query.toDate as string;

  try {
    // 2. Build Filter Clauses
    const baseWhere: any = { AND: [] };

    if (effectiveCompanyId) {
      baseWhere.AND.push({
        OR: [
          { company_id: String(effectiveCompanyId) },
          { company_id: { contains: String(effectiveCompanyId) } },
          { company_id: { contains: String(effectiveCompanyId).toLowerCase() } },
          { company_id: { contains: String(effectiveCompanyId).toUpperCase() } }
        ]
      });
    } else if (user.role !== 'super_admin') {
      baseWhere.AND.push({ id: -1 }); 
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
          select: { id: true, total: true, grand_total: true, paid_amount: true, status: true, sub_total: true, tax_total: true }
      });

      let statusIds: number[] = [];
      if (statusType === 'pending') {
          statusIds = allInvoices
              .filter(inv => {
                  const taxable = inv.sub_total ?? (parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '')) || 0);
                  const taxVal  = inv.tax_total ?? (parseFloat(String(inv.tax_total || '0').replace(/[^\d.]/g, '')) || 0);
                  let grand = parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0;
                  if (grand <= 0 && taxable > 0) grand = taxable + taxVal;
                  const paid = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
                  return (grand - paid) > 0.5;
              })
              .map(inv => inv.id);
      } else if (statusType === 'paid') {
          statusIds = allInvoices
              .filter(inv => {
                  if (inv.status === 'PAID' || inv.status === 'COMPLETED') return true;
                  const taxable = inv.sub_total ?? (parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '')) || 0);
                  const taxVal  = inv.tax_total ?? (parseFloat(String(inv.tax_total || '0').replace(/[^\d.]/g, '')) || 0);
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

    // Specific Invoice Selection Filter (Support both ID and Invoice No selection)
    if (rawInvoiceNos) {
      const parts = rawInvoiceNos.split(',').map(n => n.trim()).filter(n => n !== '');
      const numericParts = parts.map(n => parseInt(n)).filter(n => !isNaN(n));
      
      filteredWhere.AND.push({ 
        OR: [
          { invoice_no: { in: numericParts } }, 
          { id: { in: numericParts } },
          // Also check as strings just in case the IDs in DB are not parsed as integers
          { company_id: { in: parts } } // This is a fallback to catch anything missed by type casting
        ] 
      });
    }

    // 4. Execute Queries
    const [invoices, totalCount, sums] = await Promise.all([
      prisma.legacyInvoice.findMany({
        where: filteredWhere,
        skip,
        take: limit,
        orderBy: [{ invoice_date: 'desc' }, { id: 'desc' }]
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
        const taxable = inv.sub_total ?? (parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '')) || 0);
        const taxVal  = inv.tax_total ?? (parseFloat(String(inv.tax_total || '0').replace(/[^\d.]/g, '')) || 0);
        
        let grand = inv.grand_total_float ?? (parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0);
        
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

    const parsedInvoices = invoices.map((inv: any) => {
      const base = { ...inv };
      return {
        ...base,
        id: inv.id.toString(),
        invoiceNumber: inv.invoice_no?.toString() || inv.id.toString(),
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
        gst1: inv.gst1,
        gst2: inv.gst2,
        igst: inv.igst,
        gst1_per: inv.gst1_per,
        gst2_per: inv.gst2_per,
        igst_per: inv.igst_per
      };
    });

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
    address, subTotal, grandTotal, items, billType, inwardId, company_id, companyId, notes,
    po_no, po_date, dc_no, dc_date, poNo, poDate, dcNo, dcDate, gstin, state, tax_rate, taxRate
  } = req.body;

  const finalTaxRate = parseFloat(String(tax_rate || taxRate || '18'));
  const finalSubTotal = parseFloat(String(subTotal || '0'));
  const finalGrandTotal = parseFloat(String(grandTotal || '0'));
  const finalTaxTotal = finalGrandTotal - finalSubTotal;

  const isIntraState = (state || '').toLowerCase().replace(/[^a-z]/g, '') === 'tamilnadu';

  const user = req.user;
  const rawCompanyId = user?.company_id || company_id || companyId;
  const finalCompanyId = rawCompanyId ? String(rawCompanyId).toLowerCase() : null;

  try {
    const invNo = invoiceNumber ? parseInt(String(invoiceNumber).replace(/\D/g, '')) : null;
    const delNo = req.body.challanNumber ? parseInt(String(req.body.challanNumber).replace(/\D/g, '')) : null;

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

    const invoice = await prisma.$transaction(async (tx) => {
      const newInvoice = await (tx as any).legacyInvoice.create({
        data: {
          invoice_no: invNo,
          delivery_no: delNo,
          invoice_date: date ? new Date(date) : new Date(),
          due_date: dueDate ? new Date(dueDate) : null,
          customer: customerId ? { connect: { id: parseInt(String(customerId)) } } : undefined,
          customer_name: customerName,
          address,
          total: String(subTotal || '0'),
          grand_total: String(grandTotal || '0'),
          items_json: JSON.stringify(items || []),
          bill_type: billType === 'With Process' ? 'with_process' :
            billType === 'Without Process' ? 'without_process' :
              billType === 'Both' ? 'both' : 'with_process',
          inward_no: invNo,
          po_no: String(po_no || poNo || '').trim() || null,
          po_date: (po_date || poDate) ? new Date(po_date || poDate) : null,
          dc_no: String(dc_no || dcNo || '').trim() || null,
          dc_date: (dc_date || dcDate) ? new Date(dc_date || dcDate) : null,
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
        }
      });

      // Special Logic: If "Both", automatically create a Delivery Challan for "Without Process" items
      if (billType === 'Both') {
        const wopItems = items.filter((it: any) => it.wopQty > 0).map((it: any) => ({
          ...it,
          quantity: it.wopQty, // Map wopQty to quantity for the Challan
          bill_type: 'without_process'
        }));

        if (wopItems.length > 0) {
          await tx.challan.create({
            data: {
              id: crypto.randomUUID(),
              challan_no: String(delNo || invNo),
              party_id: String(customerId),
              party_name: String(customerName),
              party_type: 'customer',
              company_id: finalCompanyId,
              date: date ? new Date(date) : new Date(),
              type: 'delivery',
              status: 'COMPLETED',
              items_json: JSON.stringify(wopItems),
              vehicle_no: String(dc_no || dcNo || '').trim() || null
            }
          });
        }
      }

      if (inwardId) {
        await tx.inwardEntry.update({
          where: { id: String(inwardId) },
          data: { status: 'partial' } // Changed from 'completed' to support multiple invoices
        });
      }

      // 3. Update Ledger with running balance
      const lastEntry = await (tx.ledgerEntry as any).findFirst({
        where: {
          party_id: String(customerId),
          company_id: finalCompanyId ? String(finalCompanyId) : undefined
        },
        orderBy: { created_at: 'desc' }
      });

      const lastBalance = (lastEntry as any)?.balance ?? 0;
      // Clean numeric strings of characters like ₹, commas, etc.
      const rawGrandTotal = String(grandTotal || '0').replace(/[^\d.]/g, '');
      const amountAsFloat = parseFloat(rawGrandTotal);
      const newBalance = lastBalance + amountAsFloat;

      const totalQty = items?.reduce((acc: number, cur: any) => acc + (parseFloat(cur.quantity) || 0), 0) || 0;
      await (tx.ledgerEntry as any).create({
        data: {
          id: crypto.randomUUID(),
          party_id: String(customerId),
          party_name: customerName,
          party_type: 'customer',
          company_id: finalCompanyId ? String(finalCompanyId) : null,
          date: date ? new Date(date) : new Date(),
          vch_type: 'INVOICE',
          vch_no: String(newInvoice.invoice_no || newInvoice.id),
          type: 'debit',
          amount: amountAsFloat,
          balance: newBalance,
          description: `Invoice: ${newInvoice.invoice_no || newInvoice.id} (Qty: ${totalQty})`,
          reference_id: String(newInvoice.id)
        }
      });

      return newInvoice;
    });

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

  try {
    const invoice = await (prisma as any).legacyInvoice.update({
      where: { id: parseInt(String(id)) },
      data: {
        invoice_date: date ? new Date(date) : undefined,
        due_date: dueDate ? new Date(dueDate) : undefined,
        customer_id: customerId ? parseInt(String(customerId)) : undefined,
        customer_name: customerName,
        address,
        total: subTotal ? String(subTotal) : undefined,
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
    await (prisma as any).legacyInvoice.delete({
      where: { id: parseInt(String(id)) }
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
      where: { company_id: String(companyId) },
      orderBy: { invoice_no: 'desc' }
    });
    const lastDel = await (prisma as any).legacyInvoice.findFirst({
      where: { company_id: String(companyId) },
      orderBy: { delivery_no: 'desc' }
    });

    res.json({
      nextInvoice: (lastInv?.invoice_no || 0) + 1,
      nextChallan: (lastDel?.delivery_no || 0) + 1
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get next numbers', detail: error.message });
  }
};
