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
  const sortBy = req.query.sortBy as string;
  const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';

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

    const id = (req.query.id || req.query.inward_id) as string;
    if (id) {
      where.AND.push({ id: String(id) });
      limit = 5000;
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

    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    if (fromDate || toDate) {
      const dateFilter: any = {};
      if (fromDate) dateFilter.gte = new Date(fromDate);
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        dateFilter.lte = endOfDay;
      }
      where.AND.push({ date: dateFilter });
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
        orderBy: sortBy ? { [sortBy]: sortOrder } : [
          { date: 'desc' },
          { inward_no: 'desc' },
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
    // NOTE: We only match by inward_id (UUID) — dc_no is NOT used here because short/numeric dc_nos
    // (e.g., "9") would match thousands of unrelated invoices across the database.
    const inwardIds = entries.map(e => String(e.id));
    const inwardNos = entries.map(e => String(e.inward_no || '')).filter(Boolean);
    const inwardFormattedIds = inwardNos.map(n => `inw_${n}`);
    const allSearchIds = Array.from(new Set([...inwardIds, ...inwardNos, ...inwardFormattedIds]));
    const numericInwNos = inwardNos.map(n => parseInt(n)).filter(n => !isNaN(n));

    // Also match by dc_no + customer_id for legacy invoices where inward_no was corrupted/missing
    const dcCustomerConditions = entries
      .filter(e => e.dc_no && e.customer_id)
      .map(e => ({
        dc_no: String(e.dc_no).trim(),
        customer_id: parseInt(String(e.customer_id), 10)
      }))
      .filter(c => c.dc_no && !isNaN(c.customer_id));

    const invoiceQueryOR: any[] = [
      { inward_id: { in: allSearchIds } },
      { inward_no: { in: numericInwNos } }
    ];
    if (dcCustomerConditions.length > 0) {
      invoiceQueryOR.push(...dcCustomerConditions);
    }

    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: {
        OR: invoiceQueryOR
      }
    });
    const outwards = await prisma.outwardEntry.findMany({
      where: { inward_id: { in: inwardIds } }
    });

    const outwardIds = outwards.map(o => String(o.id));
    const allReturnedInwards = await prisma.inwardEntry.findMany({
      where: { outward_id: { in: outwardIds } }
    });

    // Pre-group outwards
    const outwardGroups = new Map<string, any[]>();
    outwards.forEach((ow: any) => {
      const gid = String(ow.inward_id);
      if (!outwardGroups.has(gid)) outwardGroups.set(gid, []);
      outwardGroups.get(gid)!.push(ow);
    });

    const parsedEntries = entries.map((e: any) => {
      const items = JSON.parse(e.items_json || '[]');
      const partyId = String(e.customer_id || e.vendor_id || '');
      
      const entryId = String(e.id || '').toLowerCase().trim();
      const entryNo = String(e.inward_no || '').toLowerCase().trim();
      const invoicedForThisEntry = invoices.filter((inv: any) => {
        if (inv.inward_id) {
          const invInwId = String(inv.inward_id).toLowerCase().trim();
          if (invInwId === entryId || invInwId === entryNo || invInwId === `inw_${entryNo}`) {
            return true;
          }
        }
        if (inv.inward_no && entryNo && String(inv.inward_no) === entryNo) {
          if (!inv.customer_id || !e.customer_id || String(inv.customer_id) === String(e.customer_id)) {
            return true;
          }
        }
        // Match by DC No and Customer ID for invoices where inward_no was not set to inward ID
        if (e.dc_no && inv.dc_no && String(e.dc_no).trim().toLowerCase() === String(inv.dc_no).trim().toLowerCase()) {
          if (e.customer_id && inv.customer_id && String(e.customer_id) === String(inv.customer_id)) {
            return true;
          }
        }
        return false;
      });
      const outwardsForThisEntry = outwardGroups.get(String(e.id)) || [];

      // 1. Pre-aggregate quantities by item identifier
      const invoicedTotals = new Map<string, number>();
      const dispatchedTotals = new Map<string, number>();
      const sentToVendorTotals = new Map<string, number>();
      const returnedFromVendorTotals = new Map<string, number>();

      invoicedForThisEntry.forEach((inv: any) => {
        const invItems = JSON.parse(inv.items_json || '[]');
        invItems.forEach((ii: any, iIdx: number) => {
          const qty = parseFloat(ii.qty || ii.quantity || '0') + parseFloat(ii.wopQty || ii.wop_qty || '0');
          const cleanName = String(ii.description || ii.item_name || '').toLowerCase().trim();
          if (cleanName) {
            invoicedTotals.set(cleanName, (invoicedTotals.get(cleanName) || 0) + qty);
          }
          if (ii.id !== undefined && ii.id !== null && ii.id !== '') {
            const strId = String(ii.id);
            invoicedTotals.set(strId, (invoicedTotals.get(strId) || 0) + qty);
          }
        });
      });

      outwardsForThisEntry.forEach((ow: any) => {
        const owItems = JSON.parse(ow.items_json || '[]');
        owItems.forEach((oi: any) => {
          const qty = parseFloat(oi.quantity || oi.qty || '0');
          const cleanName = String(oi.description || oi.item_name || '').toLowerCase().trim();
          if (ow.party_type === 'vendor') {
            if (cleanName) sentToVendorTotals.set(cleanName, (sentToVendorTotals.get(cleanName) || 0) + qty);
            if (oi.id !== undefined && oi.id !== null && oi.id !== '') {
              sentToVendorTotals.set(String(oi.id), (sentToVendorTotals.get(String(oi.id)) || 0) + qty);
            }
          } else {
            if (cleanName) dispatchedTotals.set(cleanName, (dispatchedTotals.get(cleanName) || 0) + qty);
            if (oi.id !== undefined && oi.id !== null && oi.id !== '') {
              dispatchedTotals.set(String(oi.id), (dispatchedTotals.get(String(oi.id)) || 0) + qty);
            }
          }
        });
      });

      const relatedVendorInwards = allReturnedInwards.filter((ei: any) => 
        ei.party_type === 'vendor' && outwardsForThisEntry.some(ow => String(ow.id) === String(ei.outward_id))
      );
      
      relatedVendorInwards.forEach((vi: any) => {
        const viItems = JSON.parse(vi.items_json || '[]');
        viItems.forEach((vii: any) => {
          const cleanName = String(vii.description || vii.item_name || '').toLowerCase().trim();
          const qty = parseFloat(vii.quantity || vii.qty || '0');
          if (cleanName) returnedFromVendorTotals.set(cleanName, (returnedFromVendorTotals.get(cleanName) || 0) + qty);
          if (vii.id !== undefined && vii.id !== null && vii.id !== '') {
            returnedFromVendorTotals.set(String(vii.id), (returnedFromVendorTotals.get(String(vii.id)) || 0) + qty);
          }
        });
      });

      const itemCounts = new Map<string, number>();
      items.forEach((item: any) => {
        const id = String(item.description || item.item_name || '').toLowerCase().trim();
        itemCounts.set(id, (itemCounts.get(id) || 0) + 1);
      });

      const balanceItems = items.map((item: any, idx: number) => {
        const itemIdentifier = String(item.description || item.item_name || '').toLowerCase().trim();
        const originalQty = parseFloat(item.quantity || item.qty || '0');

        const currentCount = itemCounts.get(itemIdentifier) || 0;
        itemCounts.set(itemIdentifier, currentCount - 1);
        const isLast = currentCount === 1;

        const consume = (pool: Map<string, number>, max: number) => {
          let availableByName = itemIdentifier ? (pool.get(itemIdentifier) || 0) : 0;
          let availableById = (!itemIdentifier || availableByName === 0) ? (pool.get(String(idx)) || 0) : 0;
          
          let totalAvailable = availableByName > 0 ? availableByName : availableById;
          const consumed = isLast ? totalAvailable : Math.min(totalAvailable, max);
          
          let toDeduct = consumed;
          if (availableByName > 0) {
            const deduct = Math.min(availableByName, toDeduct);
            pool.set(itemIdentifier, availableByName - deduct);
            toDeduct -= deduct;
          }
          if (toDeduct > 0 && availableById > 0) {
            const deduct = Math.min(availableById, toDeduct);
            pool.set(String(idx), availableById - deduct);
            toDeduct -= deduct;
          }
          
          return consumed;
        };

        const totalInvoiced = consume(invoicedTotals, originalQty);
        const totalDispatched = consume(dispatchedTotals, originalQty);
        const totalSentToVendor = consume(sentToVendorTotals, originalQty);
        const totalReturnedFromVendor = consume(returnedFromVendorTotals, originalQty);

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
    const finalEntries = isInvoiceScreen 
      ? parsedEntries.filter((e: any) => e.items.some((item: any) => item.billingBalance > 0))
      : parsedEntries;

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
    party_type, partyType, outward_id, outwardId, outward_no, outwardNo, date
  } = req.body;
  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? (company_id || companyId) : (user?.company_id || company_id || companyId);

  try {
    const finalInwardNo = inward_no || await generateNextSequence('app_inward_entries', 'inward_no', '', finalCompanyId, 1001);

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
            date: date ? new Date(date) : new Date(),
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
    party_type, partyType, outward_id, outwardId, outward_no, outwardNo, date
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
        date: date ? new Date(date) : undefined,
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
    // NOTE: We only match by inward_id (UUID) — dc_no is NOT used here because short/numeric dc_nos
    // (e.g., "9") would match thousands of unrelated invoices across the database, causing
    // items to appear as fully invoiced when they are not.
    const inwardIds = inwards.map(i => String(i.id));
    const inwardNos = inwards.map(i => String(i.inward_no || '')).filter(Boolean);
    const inwardFormattedIds = inwardNos.map(n => `inw_${n}`);
    const allSearchIds = Array.from(new Set([...inwardIds, ...inwardNos, ...inwardFormattedIds]));
    const numericInwNos = inwardNos.map(n => parseInt(n)).filter(n => !isNaN(n));

    const numCustId = parseInt(customerId, 10);
    const invoiceQueryConditions: any[] = [
      { inward_id: { in: allSearchIds } },
      { inward_no: { in: numericInwNos } }
    ];
    if (!isNaN(numCustId)) {
      invoiceQueryConditions.push({ customer_id: numCustId });
    }

    const relatedInvoices = await (prisma as any).legacyInvoice.findMany({
      where: {
        OR: invoiceQueryConditions
      }
    });

    // 3. Get all related outwards to calculate what's at vendors
    const relatedOutwards = await prisma.outwardEntry.findMany({
      where: {
        inward_id: { in: inwardIds }
      }
    });

    const outwardIds = relatedOutwards.map(o => String(o.id));
    const allReturnedInwards = await prisma.inwardEntry.findMany({
      where: { outward_id: { in: outwardIds } }
    });

    // Pre-group for O(1) lookup
    const outwardGroups = new Map<string, any[]>();
    relatedOutwards.forEach((ow: any) => {
      const gid = String(ow.inward_id);
      if (!outwardGroups.has(gid)) outwardGroups.set(gid, []);
      outwardGroups.get(gid)!.push(ow);
    });

    const results = inwards.map(entry => {
      const originalItems = JSON.parse(entry.items_json || '[]');
      const partyId = String(entry.customer_id || entry.vendor_id || '');
      
      const entryId = String(entry.id || '').toLowerCase().trim();
      const entryNo = String(entry.inward_no || '').toLowerCase().trim();
      const invoicedForThisEntry = relatedInvoices.filter((inv: any) => {
        if (inv.inward_id) {
          const invInwId = String(inv.inward_id).toLowerCase().trim();
          if (invInwId === entryId || invInwId === entryNo || invInwId === `inw_${entryNo}`) {
            return true;
          }
        }
        if (inv.inward_no && entryNo && String(inv.inward_no) === entryNo) {
          if (!inv.customer_id || !entry.customer_id || String(inv.customer_id) === String(entry.customer_id)) {
            return true;
          }
        }
        // Match by DC No and Customer ID for invoices where inward_no was not set to inward ID
        if (entry.dc_no && inv.dc_no && String(entry.dc_no).trim().toLowerCase() === String(inv.dc_no).trim().toLowerCase()) {
          if (entry.customer_id && inv.customer_id && String(entry.customer_id) === String(inv.customer_id)) {
            return true;
          }
        }
        return false;
      });
      const outwardsForThisEntry = outwardGroups.get(String(entry.id)) || [];

      const invoicedTotals = new Map<string, number>();
      const dispatchedTotals = new Map<string, number>();
      const sentToVendorTotals = new Map<string, number>();
      const returnedFromVendorTotals = new Map<string, number>();

      invoicedForThisEntry.forEach((inv: any) => {
        const invItems = JSON.parse(inv.items_json || '[]');
        invItems.forEach((ii: any, iIdx: number) => {
          const qty = parseFloat(ii.qty || ii.quantity || '0') + parseFloat(ii.wopQty || ii.wop_qty || '0');
          const cleanName = String(ii.description || ii.item_name || '').toLowerCase().trim();
          if (cleanName) {
            invoicedTotals.set(cleanName, (invoicedTotals.get(cleanName) || 0) + qty);
          }
          if (ii.id !== undefined && ii.id !== null && ii.id !== '') {
            const strId = String(ii.id);
            invoicedTotals.set(strId, (invoicedTotals.get(strId) || 0) + qty);
          }
        });
      });

      outwardsForThisEntry.forEach((ow: any) => {
        const owItems = JSON.parse(ow.items_json || '[]');
        owItems.forEach((oi: any) => {
          const qty = parseFloat(oi.quantity || oi.qty || '0');
          const cleanName = String(oi.description || oi.item_name || '').toLowerCase().trim();
          if (ow.party_type === 'vendor') {
            if (cleanName) sentToVendorTotals.set(cleanName, (sentToVendorTotals.get(cleanName) || 0) + qty);
            if (oi.id !== undefined && oi.id !== null && oi.id !== '') {
              sentToVendorTotals.set(String(oi.id), (sentToVendorTotals.get(String(oi.id)) || 0) + qty);
            }
          } else {
            if (cleanName) dispatchedTotals.set(cleanName, (dispatchedTotals.get(cleanName) || 0) + qty);
            if (oi.id !== undefined && oi.id !== null && oi.id !== '') {
              dispatchedTotals.set(String(oi.id), (dispatchedTotals.get(String(oi.id)) || 0) + qty);
            }
          }
        });
      });

      const vendorInwardsForThisCustomer = allReturnedInwards.filter(i => 
         i.party_type === 'vendor' && outwardsForThisEntry.some(ow => String(ow.id) === String(i.outward_id))
      );

      vendorInwardsForThisCustomer.forEach((vi: any) => {
        const viItems = JSON.parse(vi.items_json || '[]');
        viItems.forEach((vii: any) => {
          const cleanName = String(vii.description || vii.item_name || '').toLowerCase().trim();
          const qty = parseFloat(vii.quantity || vii.qty || '0');
          if (cleanName) returnedFromVendorTotals.set(cleanName, (returnedFromVendorTotals.get(cleanName) || 0) + qty);
          if (vii.id !== undefined && vii.id !== null && vii.id !== '') {
            returnedFromVendorTotals.set(String(vii.id), (returnedFromVendorTotals.get(String(vii.id)) || 0) + qty);
          }
        });
      });

      const itemCounts = new Map<string, number>();
      originalItems.forEach((item: any) => {
        const id = String(item.description || item.item_name || '').toLowerCase().trim();
        itemCounts.set(id, (itemCounts.get(id) || 0) + 1);
      });

      const balanceItems = originalItems.map((item: any, idx: number) => {
        const itemIdentifier = String(item.description || item.item_name || '').toLowerCase().trim();
        const original = parseFloat(item.quantity || item.qty || '0');

        const currentCount = itemCounts.get(itemIdentifier) || 0;
        itemCounts.set(itemIdentifier, currentCount - 1);
        const isLast = currentCount === 1;

        const consume = (pool: Map<string, number>, max: number) => {
          let availableByName = itemIdentifier ? (pool.get(itemIdentifier) || 0) : 0;
          let availableById = (!itemIdentifier || availableByName === 0) ? (pool.get(String(idx)) || 0) : 0;
          
          let totalAvailable = availableByName > 0 ? availableByName : availableById;
          const consumed = isLast ? totalAvailable : Math.min(totalAvailable, max);
          
          let toDeduct = consumed;
          if (availableByName > 0) {
            const deduct = Math.min(availableByName, toDeduct);
            pool.set(itemIdentifier, availableByName - deduct);
            toDeduct -= deduct;
          }
          if (toDeduct > 0 && availableById > 0) {
            const deduct = Math.min(availableById, toDeduct);
            pool.set(String(idx), availableById - deduct);
            toDeduct -= deduct;
          }
          
          return consumed;
        };

        const totalInvoicedQty = consume(invoicedTotals, original);
        const totalDispatchedQty = consume(dispatchedTotals, original);
        const totalSentToVendorQty = consume(sentToVendorTotals, original);
        const totalReturnedFromVendorQty = consume(returnedFromVendorTotals, original);

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

      const isCompleted = (entry.status || '').toLowerCase() === 'completed';
      const hasBillingBalance = balanceItems.some((item: any) => (item.billingBalance || 0) > 0);
      const hasBalance = !isCompleted && hasBillingBalance;

      return {
        id: entry.id,
        inward_no: entry.inward_no,
        inwardNo: entry.inward_no,
        customer_id: entry.customer_id,
        customerId: entry.customer_id,
        customerName: entry.customer_name,
        customer_name: entry.customer_name,
        vendor_id: entry.vendor_id,
        vendorId: entry.vendor_id,
        vendorName: entry.vendor_name,
        vendor_name: entry.vendor_name,
        partyType: entry.party_type,
        party_type: entry.party_type,
        date: entry.date,
        po_reference: entry.po_reference,
        poReference: entry.po_reference,
        po_date: entry.po_date,
        poDate: entry.po_date,
        challan_no: entry.challan_no,
        challanNo: entry.challan_no,
        dc_no: entry.dc_no,
        dcNo: entry.dc_no,
        dc_date: entry.dc_date,
        dcDate: entry.dc_date,
        due_date: entry.due_date,
        dueDate: entry.due_date,
        status: entry.status,
        items: balanceItems,
        totalRemaining: balanceItems.reduce((acc: number, cur: any) => acc + (cur.billingBalance || 0), 0),
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

    const entryId = String(entry.id || '').toLowerCase().trim();
    const entryNo = String(entry.inward_no || '').toLowerCase().trim();

    // Calculate balances
    const invoiceConditions: any[] = [{ inward_id: String(entry.id) }];
    if (entryNo) {
      invoiceConditions.push({ inward_id: entryNo });
      invoiceConditions.push({ inward_id: `inw_${entryNo}` });
      const numNo = parseInt(entryNo, 10);
      if (!isNaN(numNo)) {
        invoiceConditions.push({ inward_no: numNo });
      }
    }
    if (entry.dc_no && entry.customer_id) {
      const numCust = parseInt(String(entry.customer_id), 10);
      if (!isNaN(numCust)) {
        invoiceConditions.push({
          dc_no: String(entry.dc_no).trim(),
          customer_id: numCust
        });
      }
    }

    const outwardConditions: any[] = [{ inward_id: String(entry.id) }];
    if (entryNo) {
      outwardConditions.push({ inward_id: entryNo });
      outwardConditions.push({ inward_id: `inw_${entryNo}` });
    }

    const [invoices, outwards, allReturnedInwards] = await Promise.all([
      (prisma as any).legacyInvoice.findMany({
        where: { OR: invoiceConditions }
      }),
      prisma.outwardEntry.findMany({
        where: { OR: outwardConditions }
      }),
      prisma.inwardEntry.findMany({
        where: {
          party_type: 'vendor',
          outward_id: { not: null }
        }
      })
    ]);

    const invoicedTotals = new Map<string, number>();
    const dispatchedTotals = new Map<string, number>();
    const sentToVendorTotals = new Map<string, number>();
    const returnedFromVendorTotals = new Map<string, number>();

    invoices.forEach((inv: any) => {
      let matchesThisEntry = false;
      if (inv.inward_id) {
        const invInwId = String(inv.inward_id).toLowerCase().trim();
        if (invInwId === entryId || invInwId === entryNo || invInwId === `inw_${entryNo}`) {
          matchesThisEntry = true;
        }
      }
      if (!matchesThisEntry && inv.inward_no && entryNo && String(inv.inward_no) === entryNo) {
        if (!inv.customer_id || !entry.customer_id || String(inv.customer_id) === String(entry.customer_id)) {
          matchesThisEntry = true;
        }
      }
      if (!matchesThisEntry && entry.dc_no && inv.dc_no && String(entry.dc_no).trim().toLowerCase() === String(inv.dc_no).trim().toLowerCase()) {
        if (entry.customer_id && inv.customer_id && String(entry.customer_id) === String(inv.customer_id)) {
          matchesThisEntry = true;
        }
      }
      if (!matchesThisEntry) return;

      const invItems = JSON.parse(inv.items_json || '[]');
      invItems.forEach((ii: any) => {
        const qty = parseFloat(ii.qty || ii.quantity || '0') + parseFloat(ii.wopQty || ii.wop_qty || '0');
        const cleanName = String(ii.description || ii.item_name || '').toLowerCase().trim();
        if (cleanName) {
          invoicedTotals.set(cleanName, (invoicedTotals.get(cleanName) || 0) + qty);
        }
        if (ii.id !== undefined && ii.id !== null && ii.id !== '') {
          const strId = String(ii.id);
          invoicedTotals.set(strId, (invoicedTotals.get(strId) || 0) + qty);
        }
      });
    });

    outwards.forEach((ow: any) => {
      const owItems = JSON.parse(ow.items_json || '[]');
      owItems.forEach((oi: any) => {
        const qty = parseFloat(oi.quantity || oi.qty || '0');
        const cleanName = String(oi.description || oi.item_name || '').toLowerCase().trim();
        if (ow.party_type === 'vendor') {
          if (cleanName) sentToVendorTotals.set(cleanName, (sentToVendorTotals.get(cleanName) || 0) + qty);
          if (oi.id !== undefined && oi.id !== null && oi.id !== '') {
            sentToVendorTotals.set(String(oi.id), (sentToVendorTotals.get(String(oi.id)) || 0) + qty);
          }
        } else {
          if (cleanName) dispatchedTotals.set(cleanName, (dispatchedTotals.get(cleanName) || 0) + qty);
          if (oi.id !== undefined && oi.id !== null && oi.id !== '') {
            dispatchedTotals.set(String(oi.id), (dispatchedTotals.get(String(oi.id)) || 0) + qty);
          }
        }
      });
    });

    const relatedVendorInwards = allReturnedInwards.filter((ei: any) => 
      ei.party_type === 'vendor' && outwards.some((ow: any) => String(ow.id) === String(ei.outward_id))
    );

    relatedVendorInwards.forEach((vi: any) => {
      const viItems = JSON.parse(vi.items_json || '[]');
      viItems.forEach((vii: any) => {
        const cleanName = String(vii.description || vii.item_name || '').toLowerCase().trim();
        const qty = parseFloat(vii.quantity || vii.qty || '0');
        if (cleanName) returnedFromVendorTotals.set(cleanName, (returnedFromVendorTotals.get(cleanName) || 0) + qty);
        if (vii.id !== undefined && vii.id !== null && vii.id !== '') {
          returnedFromVendorTotals.set(String(vii.id), (returnedFromVendorTotals.get(String(vii.id)) || 0) + qty);
        }
      });
    });

    const itemCounts = new Map<string, number>();
    items.forEach((item: any) => {
      const id = String(item.description || item.item_name || '').toLowerCase().trim();
      itemCounts.set(id, (itemCounts.get(id) || 0) + 1);
    });

    const balanceItems = items.map((item: any, idx: number) => {
      const itemIdentifier = String(item.description || item.item_name || '').toLowerCase().trim();
      const originalQty = parseFloat(item.quantity || item.qty || '0');

      const currentCount = itemCounts.get(itemIdentifier) || 0;
      itemCounts.set(itemIdentifier, currentCount - 1);
      const isLast = currentCount === 1;

      const consume = (pool: Map<string, number>, max: number) => {
        let availableByName = itemIdentifier ? (pool.get(itemIdentifier) || 0) : 0;
        let availableById = (!itemIdentifier || availableByName === 0) ? (pool.get(String(idx)) || 0) : 0;
        
        let totalAvailable = availableByName > 0 ? availableByName : availableById;
        const consumed = isLast ? totalAvailable : Math.min(totalAvailable, max);
        
        let toDeduct = consumed;
        if (availableByName > 0) {
          const deduct = Math.min(availableByName, toDeduct);
          pool.set(itemIdentifier, availableByName - deduct);
          toDeduct -= deduct;
        }
        if (toDeduct > 0 && availableById > 0) {
          const deduct = Math.min(availableById, toDeduct);
          pool.set(String(idx), availableById - deduct);
          toDeduct -= deduct;
        }
        
        return consumed;
      };

      const totalInvoiced = consume(invoicedTotals, originalQty);
      const totalDispatched = consume(dispatchedTotals, originalQty);
      const totalSentToVendor = consume(sentToVendorTotals, originalQty);
      const totalReturnedFromVendor = consume(returnedFromVendorTotals, originalQty);

      const currentlyAtVendor = Math.max(0, totalSentToVendor - totalReturnedFromVendor);

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
        remainingQty: Math.max(billingBalance, dispatchBalance),
        inHouseQty: dispatchBalance
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

export const generateDcNo = async (req: AuthRequest, res: Response) => {
  try {
    const finalCompanyId = req.query.companyId || req.user?.company_id;
    if (!finalCompanyId) {
      return res.status(400).json({ error: 'Company ID is required' });
    }
    const dcNo = await generateNextSequence('app_inward_entries', 'dc_no', '', String(finalCompanyId), 4001);
    res.json({ dcNo });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate DC No', detail: error.message });
  }
};

export const cancelInwardEntry = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user;
  
  try {
    const entry = await prisma.inwardEntry.findUnique({ where: { id: String(id) } });
    if (!entry) return res.status(404).json({ error: 'Inward entry not found' });
    if (entry.status !== 'pending') return res.status(400).json({ error: 'Only pending inwards can be cancelled' });

    const finalCompanyId = entry.company_id;
    const prefix = 'CH-CU-';
    const finalOutwardNo = await generateNextSequence('app_outward_entries', 'outward_no', prefix, finalCompanyId, 2001);

    const outwardEntry = await prisma.outwardEntry.create({
      data: {
        id: crypto.randomUUID(),
        outward_no: finalOutwardNo,
        party_type: 'customer',
        customer_id: entry.customer_id,
        customer_name: entry.customer_name,
        company_id: finalCompanyId,
        inward_id: entry.id,
        inward_no: entry.inward_no,
        status: 'cancelled',
        items_json: entry.items_json,
        date: new Date(),
        notes: 'Auto-generated for Cancelled Inward'
      }
    });

    const updatedInward = await prisma.inwardEntry.update({
      where: { id: String(id) },
      data: { 
        status: 'cancelled',
        outward_id: outwardEntry.id,
        outward_no: outwardEntry.outward_no
      }
    });

    res.json({ message: 'Inward cancelled successfully', outwardNo: outwardEntry.outward_no });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to cancel inward', detail: error.message });
  }
};
