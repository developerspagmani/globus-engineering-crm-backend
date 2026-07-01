import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';
import { generateNextSequence } from '../../utils/sequenceGenerator';

export const getInwardEntries = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.companyId || req.query.company_id) as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId);

  // Pagination & Filter Params
  const page = parseInt(req.query.page as string) || 1;
  const requestedLimit = parseInt(req.query.limit as string);
  
  // Selection Mode Expansion: If frontend requests a large limit (standard for selection dropdowns/modals is 100 or 1000),
  // we expand to 5000 to ensure the user sees all 200+ pending records.
  let limit = requestedLimit || 10;
  if (requestedLimit >= 100) {
    limit = 5000;
  }
  const skip = (page - 1) * limit;
  const search = (req.query.search as string || '').toLowerCase();

  try {
    const where: any = {
      AND: []
    };

    if (companyId) {
      where.AND.push({
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() },
          { company_id: String(companyId).toUpperCase() }
        ]
      });
    }

    if (search) {
      where.AND.push({
        OR: [
          { inward_no: { contains: search } },
          { customer_name: { contains: search } },
          { vendor_name: { contains: search } },
          { dc_no: { contains: search } },
          { challan_no: { contains: search } },
          { po_reference: { contains: search } }
        ]
      });
    }

    const status = req.query.status as string;
    if (status && status !== 'all') {
      where.AND.push({ status: status });
    }
    
    const partyType = req.query.partyType as string;
    if (partyType && partyType !== 'all') {
      if (partyType === 'customer') {
        where.AND.push({
          OR: [
            { party_type: 'customer' },
            { party_type: null },
            { party_type: '' }
          ]
        });
      } else {
        where.AND.push({ party_type: partyType });
      }
    }

    const countWhere = {
      ...where,
      AND: (where.AND || []).filter((cond: any) => cond.status === undefined)
    };

    const [entries, totalCount, completedCount, pendingCount, partiesRaw] = await Promise.all([
      prisma.inwardEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { date: 'desc' },
          { created_at: 'desc' }
        ]
      }),
      prisma.inwardEntry.count({ where }),
      prisma.inwardEntry.count({ where: { ...countWhere, AND: [...countWhere.AND, { status: 'completed' }] } }),
      prisma.inwardEntry.count({ where: { ...countWhere, AND: [...countWhere.AND, { status: 'pending' }] } }),
      prisma.inwardEntry.findMany({
        where,
        select: { customer_name: true, vendor_name: true },
        distinct: ['customer_name']
      })
    ]);

    // Fetch related records only for the paginated entries to calculate balances
    const inwardIds = entries.map(e => e.id);
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: { inward_id: { in: inwardIds } }
    });
    const outwards = await prisma.outwardEntry.findMany({
      where: { inward_id: { in: inwardIds } }
    });

    const outwardIds = outwards.map(o => String(o.id));
    const allReturnedInwards = await prisma.inwardEntry.findMany({
      where: { outward_id: { in: outwardIds } }
    });

    // Pre-group invoices and outwards
    const invoiceGroups = new Map<string, any[]>();
    invoices.forEach((inv: any) => {
      const gid = String(inv.inward_id);
      if (!invoiceGroups.has(gid)) invoiceGroups.set(gid, []);
      invoiceGroups.get(gid)!.push(inv);
    });

    const outwardGroups = new Map<string, any[]>();
    outwards.forEach((ow: any) => {
      const gid = String(ow.inward_id);
      if (!outwardGroups.has(gid)) outwardGroups.set(gid, []);
      outwardGroups.get(gid)!.push(ow);
    });

    const parsedEntries = entries.map((e: any) => {
      const items = JSON.parse(e.items_json || '[]');
      const invoicedForThisEntry = invoiceGroups.get(String(e.id)) || [];
      const outwardsForThisEntry = outwardGroups.get(String(e.id)) || [];

      const balanceItems = items.map((item: any) => {
        let totalInvoiced = 0;
        let totalDispatched = 0;
        let totalSentToVendor = 0;
        let totalReturnedFromVendor = 0;
        const itemIdentifier = (item.description || item.item_name || '').toLowerCase();

        // 1. Add Invoiced quantities (Billed to customer)
        invoicedForThisEntry.forEach((inv: any) => {
          const invItems = JSON.parse(inv.items_json || '[]');
          const matchingItem = invItems.find((ii: any) => (ii.description || ii.item_name || '').toLowerCase() === itemIdentifier);
          if (matchingItem) {
            totalInvoiced += (parseFloat(matchingItem.qty || matchingItem.quantity || '0') + parseFloat(matchingItem.wopQty || matchingItem.wop_qty || '0'));
          }
        });

        // 2. Add Outward quantities (Sent to Vendor OR Customer)
        outwardsForThisEntry.forEach((ow: any) => {
          const owItems = JSON.parse(ow.items_json || '[]');
          const matchingItem = owItems.find((oi: any) => (oi.description || oi.item_name || '').toLowerCase() === itemIdentifier);
          if (matchingItem) {
            if (ow.party_type === 'vendor') {
              totalSentToVendor += parseFloat(matchingItem.quantity || matchingItem.qty || '0');
            } else {
              // Standard Customer Delivery
              totalDispatched += parseFloat(matchingItem.quantity || matchingItem.qty || '0');
            }
          }
        });

        // 3. Find Inwards FROM Vendors that link to Outwards to Vendors linked to THIS Inward
        const relatedVendorInwards = allReturnedInwards.filter((ei: any) => 
          ei.party_type === 'vendor' &&
          outwardsForThisEntry.some(ow => String(ow.id) === String(ei.outward_id))
        );

        relatedVendorInwards.forEach((vi: any) => {
          const viItems = JSON.parse(vi.items_json || '[]');
          const matchingItem = viItems.find((vii: any) => (vii.description || vii.item_name || '').toLowerCase() === itemIdentifier);
          if (matchingItem) {
            totalReturnedFromVendor += parseFloat(matchingItem.quantity || matchingItem.qty || '0');
          }
        });

        const originalQty = parseFloat(item.quantity || item.qty || '0');
        const currentlyAtVendor = Math.max(0, totalSentToVendor - totalReturnedFromVendor);
        
        // DUAL BALANCE LOGIC:
        // Billing balance = How much is left to be invoiced
        // Dispatch balance = How much is left in house to be shipped to customer
        const billingBalance = Math.max(0, originalQty - totalInvoiced);
        const vendorWorkBalance = Math.max(0, billingBalance - currentlyAtVendor);
        const dispatchBalance = Math.max(0, originalQty - totalDispatched - currentlyAtVendor);

        return {
          ...item,
          originalQty,
          invoicedQty: totalInvoiced,
          dispatchedQty: totalDispatched,
          atVendorQty: currentlyAtVendor,
          returnedQty: totalReturnedFromVendor,
          billingBalance: billingBalance,
          vendorWorkBalance: vendorWorkBalance,
          dispatchBalance: dispatchBalance,
          remainingQty: Math.max(billingBalance, dispatchBalance), // Used for general pending status
          inHouseQty: dispatchBalance
        };
      });

      return {
        ...e,
        customerName: e.customer_name,
        vendorName: e.vendor_name,
        inwardNo: e.inward_no,
        poReference: e.po_reference,
        poDate: e.po_date,
        challanNo: e.challan_no,
        dcNo: e.dc_no,
        dcDate: e.dc_date,
        vehicleNo: e.vehicle_no,
        companyId: e.company_id,
        dueDate: e.due_date,
        createdAt: e.created_at,
        items: balanceItems,
        totalRemaining: balanceItems.reduce((acc: number, cur: any) => acc + cur.remainingQty, 0),
        outwardId: e.outward_id,
        outwardNo: e.outward_no,
        partyType: e.party_type
      };
    });

    const isInvoiceScreen = req.query.purpose === 'invoice' || req.query.type === 'invoice' || String(req.headers.referer || '').includes('invoice');
    const finalEntries = parsedEntries;

    res.json({
      items: finalEntries,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      },
      statusCounts: {
        completed: completedCount,
        pending: pendingCount,
        activeParties: partiesRaw.length
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch inward entries with balance', detail: error.message });
  }
};

export const createInwardEntry = async (req: AuthRequest, res: Response) => {
  const {
    inward_no, customer_id, customer_name, address, vendor_id, vendor_name,
    po_reference, po_date, challan_no, dc_no, dc_date, due_date, vehicle_no, status, items, company_id, companyId,
    party_type, partyType, outward_id, outwardId, outward_no, outwardNo
  } = req.body;
  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? (company_id || companyId) : (user?.company_id || company_id || companyId);

  try {
    const finalInwardNo = inward_no || await generateNextSequence('app_inward_entries', 'inward_no', 'INW-', finalCompanyId);

    let attempts = 0;
    let entry;
    while (attempts < 3) {
      try {
        entry = await prisma.inwardEntry.create({
          data: {
            id: crypto.randomUUID(),
            inward_no: finalInwardNo,
            customer_id: String(customer_id || ''),
            customer_name,
            address,
            vendor_id: String(vendor_id || ''),
            vendor_name: String(vendor_name || ''),
            po_reference: String(po_reference || ''),
            po_date: po_date ? new Date(po_date) : null,
            challan_no: String(challan_no || ''),
            dc_no: String(dc_no || ''),
            dc_date: dc_date ? new Date(dc_date) : null,
            vehicle_no: String(vehicle_no || ''),
            company_id: String(finalCompanyId || ''),
            status: status || 'pending',
            items_json: JSON.stringify(items || []),
            due_date: due_date ? new Date(due_date) : null,
            date: new Date(),
            party_type: party_type || partyType || 'customer',
            outward_id: String(outward_id || outwardId || ''),
            outward_no: String(outward_no || outwardNo || '')
          }
        });
        break;
      } catch (error: any) {
        attempts++;
        if (attempts < 3 && (error.message.includes('reach database') || error.code?.startsWith('P1'))) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          continue;
        }
        throw error;
      }
    }

    res.status(201).json({
      ...entry,
      items: JSON.parse((entry as any).items_json || '[]')
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create inward entry', detail: error.message });
  }
};

export const updateInwardEntry = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const {
    inward_no, customer_id, customer_name, address, vendor_id, vendor_name,
    po_reference, po_date, challan_no, dc_no, dc_date, due_date, vehicle_no, status, items,
    party_type, partyType, outward_id, outwardId, outward_no, outwardNo
  } = req.body;

  try {
    const entry = await prisma.inwardEntry.update({
      where: { id: String(id) },
      data: {
        inward_no,
        customer_id,
        customer_name,
        address,
        vendor_id,
        vendor_name,
        po_reference,
        po_date: po_date ? new Date(po_date) : undefined,
        challan_no,
        dc_no,
        dc_date: dc_date ? new Date(dc_date) : undefined,
        vehicle_no,
        status,
        due_date: due_date ? new Date(due_date) : undefined,
        items_json: items ? JSON.stringify(items) : undefined,
        party_type: party_type || partyType,
        outward_id: outward_id || outwardId,
        outward_no: outward_no || outwardNo,
      }
    });

    res.json({
      ...entry,
      items: JSON.parse((entry as any).items_json || '[]')
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update inward entry', detail: error.message });
  }
};

export const getPendingInwardsByCustomer = async (req: AuthRequest, res: Response) => {
  const customerId = String(req.params.customerId);
  const user = req.user;
  const companyId = user?.company_id;

  try {
    // 0. Lookup the customer name by ID to handle name/id inconsistency in inwards
    const isIdNumeric = !isNaN(parseInt(customerId));
    const customer = await prisma.legacyCustomer.findFirst({
      where: {
        OR: [
          ...(isIdNumeric ? [{ id: parseInt(customerId) }] : []),
          { customer_name: String(customerId) }
        ]
      }
    });

    const nameToSearch = customer?.customer_name || String(customerId);
    // console.log(`[DIAGNOSTIC] Searching for Patient: ${customerId} / ${nameToSearch}`);

    // 1. Get all inwards for this customer (Temporary broad search for debugging)
    const inwards = await prisma.inwardEntry.findMany({
      where: {
        AND: [
          {
            OR: [
              { company_id: String(companyId) },
              { company_id: String(companyId).toLowerCase() },
              { company_id: String(companyId).toUpperCase() }
            ]
          },
          {
            OR: [
              { status: 'pending' },
              { status: 'partial' },
              { status: null }
            ]
          },
          {
            OR: [
              { customer_id: { contains: String(customerId) } },
              { customer_name: { contains: String(customerId) } },
              { customer_name: { contains: nameToSearch } }
            ]
          }
        ]
      }
    });

    // console.log(`[DIAGNOSTIC] Total Inwards found before filter: ${inwards.length}`);

    // 2. Get all invoices to calculate balance
    const relatedInvoices = await (prisma as any).legacyInvoice.findMany({
      where: {
        inward_id: { in: inwards.map(i => i.id) }
      }
    });

    // 3. Get all related outwards to calculate what's at vendors
    const relatedOutwards = await prisma.outwardEntry.findMany({
      where: {
        inward_id: { in: inwards.map(i => i.id) }
      }
    });

    const outwardIds = relatedOutwards.map(o => String(o.id));
    const allReturnedInwards = await prisma.inwardEntry.findMany({
      where: { outward_id: { in: outwardIds } }
    });

    // Pre-group for O(1) lookup
    const invoiceGroups = new Map<string, any[]>();
    relatedInvoices.forEach((inv: any) => {
      const gid = String(inv.inward_id);
      if (!invoiceGroups.has(gid)) invoiceGroups.set(gid, []);
      invoiceGroups.get(gid)!.push(inv);
    });

    const outwardGroups = new Map<string, any[]>();
    relatedOutwards.forEach((ow: any) => {
      const gid = String(ow.inward_id);
      if (!outwardGroups.has(gid)) outwardGroups.set(gid, []);
      outwardGroups.get(gid)!.push(ow);
    });

    const results = inwards.map(entry => {
      const originalItems = JSON.parse(entry.items_json || '[]');
      const invoicedForThisEntry = invoiceGroups.get(String(entry.id)) || [];
      const outwardsForThisEntry = outwardGroups.get(String(entry.id)) || [];

      const balanceItems = originalItems.map((item: any) => {
        let totalInvoicedQty = 0;
        let totalDispatchedQty = 0;
        let totalSentToVendorQty = 0;
        let totalReturnedFromVendorQty = 0;
        const itemIdentifier = (item.description || item.item_name || '').toLowerCase();

        invoicedForThisEntry.forEach((inv: any) => {
          const invItems = JSON.parse(inv.items_json || '[]');
          const matchingItem = invItems.find((ii: any) => (ii.description || ii.item_name || '').toLowerCase() === itemIdentifier);
          if (matchingItem) {
            totalInvoicedQty += (parseFloat(matchingItem.qty || matchingItem.quantity || '0') + parseFloat(matchingItem.wopQty || matchingItem.wop_qty || '0'));
          }
        });

        outwardsForThisEntry.forEach((ow: any) => {
          const owItems = JSON.parse(ow.items_json || '[]');
          const matchingItem = owItems.find((oi: any) => (oi.description || oi.item_name || '').toLowerCase() === itemIdentifier);
          if (matchingItem) {
            if (ow.party_type === 'vendor') {
              totalSentToVendorQty += parseFloat(matchingItem.quantity || matchingItem.qty || '0');
            } else {
              totalDispatchedQty += parseFloat(matchingItem.quantity || matchingItem.qty || '0');
            }
          }
        });

        // Find Vendor Returns
        const vendorInwardsForThisCustomer = allReturnedInwards.filter(i => 
           i.party_type === 'vendor' && 
           outwardsForThisEntry.some(ow => String(ow.id) === String(i.outward_id))
        );

        vendorInwardsForThisCustomer.forEach((vi: any) => {
          const viItems = JSON.parse(vi.items_json || '[]');
          const matchingItem = viItems.find((vii: any) => (vii.description || vii.item_name || '').toLowerCase() === itemIdentifier);
          if (matchingItem) {
            totalReturnedFromVendorQty += parseFloat(matchingItem.quantity || matchingItem.qty || '0');
          }
        });

        const original = parseFloat(item.quantity || item.qty || '0');
        const currentlyAtVendor = Math.max(0, totalSentToVendorQty - totalReturnedFromVendorQty);
        
        const billingBalance = Math.max(0, original - totalInvoicedQty);
        const vendorWorkBalance = Math.max(0, billingBalance - currentlyAtVendor);
        const dispatchBalance = Math.max(0, original - totalDispatchedQty - currentlyAtVendor);

        return {
          ...item,
          originalQty: original,
          invoicedQty: totalInvoicedQty,
          dispatchedQty: totalDispatchedQty,
          sentToVendor: currentlyAtVendor,
          returnedQty: totalReturnedFromVendorQty,
          billingBalance: billingBalance,
          vendorWorkBalance: vendorWorkBalance,
          dispatchBalance: dispatchBalance,
          remainingQty: Math.max(billingBalance, dispatchBalance),
          inHouseQty: dispatchBalance
        };
      });

      const isInvoiceScreen = req.query.purpose === 'invoice' || req.query.type === 'invoice' || String(req.headers.referer || '').includes('invoice');
      
      let hasBalance = false;
      if (isInvoiceScreen) {
        hasBalance = balanceItems.some((item: any) => item.billingBalance > 0);
      } else {
        hasBalance = balanceItems.some((item: any) => item.remainingQty > 0);
      }
      
      // console.log(`[DIAGNOSTIC] Inward #${entry.inward_no}: hasBalance=${hasBalance}, Items=${balanceItems.length}`);

      return {
        id: entry.id,
        inward_no: entry.inward_no,
        customerName: entry.customer_name,
        vendorName: entry.vendor_name,
        date: entry.date,
        po_reference: entry.po_reference,
        po_date: entry.po_date,
        dc_no: entry.dc_no,
        dc_date: entry.dc_date,
        due_date: entry.due_date,
        status: entry.status,
        items: balanceItems,
        hasBalance
      };
    }).filter(r => r.hasBalance);

    res.json(results);
  } catch (error: any) {
    console.error("[DIAGNOSTIC] CRITICAL ERROR:", error);
    res.status(500).json({ error: 'Failed to calculate inward balance', detail: error.message });
  }
};

export const deleteInwardEntry = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.inwardEntry.delete({ where: { id: String(id) } });
    res.json({ message: 'Inward entry deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete inward entry', detail: error.message });
  }
};

export const getInwardById = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const entry = await prisma.inwardEntry.findUnique({
      where: { id: String(id) }
    });

    if (!entry) {
      return res.status(404).json({ error: 'Inward entry not found' });
    }

    // Parse items
    const items = JSON.parse(entry.items_json || '[]');

    // Calculate balances
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: { inward_id: String(entry.id) }
    });
    const outwards = await prisma.outwardEntry.findMany({
      where: { inward_id: String(entry.id) }
    });

    const balanceItems = items.map((item: any) => {
      let totalInvoiced = 0;
      let totalDispatched = 0;
      const itemIdentifier = (item.description || item.item_name || '').toLowerCase();

      // Add Invoiced quantities
      invoices.forEach((inv: any) => {
        const invItems = JSON.parse(inv.items_json || '[]');
        const matchingItem = invItems.find((ii: any) => (ii.description || ii.item_name || '').toLowerCase() === itemIdentifier);
        if (matchingItem) {
          totalInvoiced += (parseFloat(matchingItem.qty || matchingItem.quantity || '0') + parseFloat(matchingItem.wopQty || matchingItem.wop_qty || '0'));
        }
      });

      // Add Outward quantities
      outwards.forEach((ow: any) => {
        const owItems = JSON.parse(ow.items_json || '[]');
        const matchingItem = owItems.find((oi: any) => (oi.description || oi.item_name || '').toLowerCase() === itemIdentifier);
        if (matchingItem) {
          if (ow.party_type === 'vendor') {
            // Vendor sent qty is tracked but we focus on dispatchBalance for customer return
          } else {
             totalDispatched += parseFloat(matchingItem.quantity || matchingItem.qty || '0');
          }
        }
      });

      const originalQty = parseFloat(item.quantity || item.qty || '0');
      const billingBalance = Math.max(0, originalQty - totalInvoiced);
      const dispatchBalance = Math.max(0, originalQty - totalDispatched); // Simplified for direct customer return

      return {
        ...item,
        originalQty,
        invoicedQty: totalInvoiced,
        dispatchedQty: totalDispatched,
        billingBalance: billingBalance,
        dispatchBalance: dispatchBalance,
        remainingQty: Math.max(billingBalance, dispatchBalance)
      };
    });

    res.json({
      ...entry,
      customerName: entry.customer_name,
      vendorName: entry.vendor_name,
      inwardNo: entry.inward_no,
      poReference: entry.po_reference,
      poDate: entry.po_date,
      challanNo: entry.challan_no,
      dcNo: entry.dc_no,
      dcDate: entry.dc_date,
      vehicleNo: entry.vehicle_no,
      companyId: entry.company_id,
      dueDate: entry.due_date,
      createdAt: entry.created_at,
      items: balanceItems,
      totalRemaining: balanceItems.reduce((acc: number, cur: any) => acc + cur.remainingQty, 0),
      outwardId: entry.outward_id,
      outwardNo: entry.outward_no,
      partyType: entry.party_type
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch inward entry details', detail: error.message });
  }
};
