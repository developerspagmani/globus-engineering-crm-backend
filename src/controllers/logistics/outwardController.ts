import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';
import { generateNextSequence } from '../../utils/sequenceGenerator';

export const getOutwardEntries = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.companyId || req.query.company_id) as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  // Pagination & Filter Params
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
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
          { outward_no: { contains: search } },
          { customer_name: { contains: search } },
          { vendor_name: { contains: search } },
          { challan_no: { contains: search } },
          { vehicle_no: { contains: search } }
        ]
      });
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

    const status = req.query.status as string;
    if (status && status !== 'all') {
      where.AND.push({ status: status });
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

    const [entries, totalCount] = await Promise.all([
      prisma.outwardEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { date: 'desc' },
          { created_at: 'desc' }
        ]
      }),
      prisma.outwardEntry.count({ where })
    ]);
    
    const parsedEntries = entries.map((e: any) => ({
      ...e,
      outwardNo: e.outward_no,
      partyType: e.party_type,
      customerName: e.customer_name,
      vendorName: e.vendor_name,
      processName: e.process_name,
      invoiceReference: e.invoice_reference,
      challanNo: e.challan_no,
      vehicleNo: e.vehicle_no,
      driverName: e.driver_name,
      companyId: e.company_id,
      inwardId: e.inward_id,
      inwardNo: e.inward_no,
      createdAt: e.created_at,
      items: JSON.parse(e.items_json || '[]')
    }));
    
    res.json({
      items: parsedEntries,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch outward entries', detail: error.message });
  }
};

export const createOutwardEntry = async (req: AuthRequest, res: Response) => {
  const { 
    outward_no, outwardNo,
    party_type, partyType,
    customer_id, customerId,
    customer_name, customerName,
    vendor_id, vendorId,
    vendor_name, vendorName,
    process_name, processName,
    invoice_reference, invoiceReference,
    challan_no, challanNo,
    vehicle_no, vehicleNo,
    driver_name, driverName,
    notes, status, items, company_id, companyId,
    inward_id, inwardId,
    inward_no, inwardNo
  } = req.body;
  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? (company_id || companyId) : user?.company_id;
  
  const finalOutwardNo = outward_no || outwardNo || await generateNextSequence('app_outward_entries', 'outward_no', 'CH-', finalCompanyId);
  const finalPartyType = party_type || partyType || 'customer';
  const finalCustomerId = customer_id || customerId;
  const finalCustomerName = customer_name || customerName;
  const finalVendorId = vendor_id || vendorId;
  const finalVendorName = vendor_name || vendorName;
  const finalProcessName = process_name || processName;
  const finalInwardId = inward_id || inwardId;
  const finalInwardNo = inward_no || inwardNo;

  try {
    const entry = await prisma.$transaction(async (tx) => {
      const newEntry = await (tx.outwardEntry as any).create({
        data: {
          id: crypto.randomUUID(),
          outward_no: finalOutwardNo,
          party_type: finalPartyType,
          customer_id: finalCustomerId,
          customer_name: finalCustomerName,
          vendor_id: finalVendorId,
          vendor_name: finalVendorName,
          process_name: finalProcessName,
          invoice_reference: String(invoice_reference || invoiceReference || ''),
          challan_no: String(challan_no || challanNo || ''),
          vehicle_no: String(vehicle_no || vehicleNo || ''),
          driver_name: String(driver_name || driverName || ''),
          notes: String(notes || ''),
          company_id: finalCompanyId,
          inward_id: String(finalInwardId || ''),
          inward_no: String(finalInwardNo || ''),
          status: status || 'completed',
          amount: parseFloat(String(req.body.amount || '0')),
          items_json: JSON.stringify(items || []),
          date: new Date()
        }
      });

      // DUAL-COMPLETION STATUS UPDATE
      if (finalInwardId) {
        const inwardIdStr = String(finalInwardId);
        const inward = await tx.inwardEntry.findUnique({ where: { id: inwardIdStr } });
        if (inward) {
          const originalItems = JSON.parse(inward.items_json || '[]');
          const allInvoices = await (tx as any).legacyInvoice.findMany({ where: { inward_id: inwardIdStr } });
          const allOutwards = await tx.outwardEntry.findMany({ where: { inward_id: inwardIdStr } });
          
          // Optimization: Pre-aggregate billed and dispatched totals to avoid nested loop overhead
          const billedMap = new Map<string, number>();
          const dispatchedMap = new Map<string, number>();

          allInvoices.forEach((inv: any) => {
            const invItems = JSON.parse(inv.items_json || '[]');
            invItems.forEach((ii: any) => {
              const iden = (ii.description || ii.item_name || '').toLowerCase();
              const qty = (parseFloat(ii.qty || ii.quantity || '0') + parseFloat(ii.wopQty || ii.wop_qty || '0'));
              billedMap.set(iden, (billedMap.get(iden) || 0) + qty);
            });
          });

          allOutwards.forEach((ow: any) => {
            const owItems = JSON.parse(ow.items_json || '[]');
            owItems.forEach((oi: any) => {
              const iden = (oi.description || oi.item_name || '').toLowerCase();
              if (ow.party_type !== 'vendor') {
                const qty = parseFloat(oi.quantity || oi.qty || '0');
                dispatchedMap.set(iden, (dispatchedMap.get(iden) || 0) + qty);
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

      return newEntry;
    }, {
      timeout: 20000
    });

    // 2. AUTOMATIC LEDGER ENTRY REMOVED as per request.
    // (Previously, this block created a 'debit' entry for Vendor Job Work)

    res.status(201).json({
      ...entry,
      items: JSON.parse((entry as any).items_json || '[]')
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create outward entry', detail: error.message });
  }
};

export const updateOutwardEntry = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { 
    outward_no, outwardNo,
    party_type, partyType,
    customer_id, customerId,
    customer_name, customerName,
    vendor_id, vendorId,
    vendor_name, vendorName,
    process_name, processName,
    invoice_reference, invoiceReference,
    challan_no, challanNo,
    vehicle_no, vehicleNo,
    driver_name, driverName,
    notes, status, items 
  } = req.body;

  const finalOutwardNo = outward_no || outwardNo;
  const finalPartyType = party_type || partyType;
  const finalVendorId = vendor_id || vendorId;
  const finalVendorName = vendor_name || vendorName;
  const finalProcessName = process_name || processName;

  try {
    const entry = await prisma.$transaction(async (tx) => {
      const updatedEntry = await (tx.outwardEntry as any).update({
        where: { id: String(id) },
        data: {
          outward_no,
          party_type,
          customer_id,
          customer_name,
          vendor_id,
          vendor_name,
          process_name,
          invoice_reference,
          challan_no,
          vehicle_no,
          driver_name,
          notes,
          status,
          items_json: items ? JSON.stringify(items) : undefined,
          amount: parseFloat(String(req.body.amount || 0)),
        }
      });

      // DUAL-COMPLETION STATUS UPDATE
      const effInwardId = updatedEntry.inward_id;
      if (effInwardId) {
        const inwardIdStr = String(effInwardId);
        const inward = await tx.inwardEntry.findUnique({ where: { id: inwardIdStr } });
        if (inward) {
          const originalItems = JSON.parse(inward.items_json || '[]');
          const allInvoices = await (tx as any).legacyInvoice.findMany({ where: { inward_id: inwardIdStr } });
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

      return updatedEntry;
    }, {
      timeout: 20000
    });

    // 2. AUTOMATIC LEDGER SYNC REMOVED as per request.
    // (Previously, this block synced the 'debit' entry for Vendor Job Work)

    res.json({
      ...entry,
      items: JSON.parse((entry as any).items_json || '[]')
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update outward entry', detail: error.message });
  }
};

export const deleteOutwardEntry = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.outwardEntry.delete({ where: { id: String(id) } });
    res.json({ message: 'Outward entry deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete outward entry', detail: error.message });
  }
};

export const getOutwardById = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const entry = await prisma.outwardEntry.findUnique({
      where: { id: String(id) }
    });

    if (!entry) {
      return res.status(404).json({ error: 'Outward entry not found' });
    }

    res.json({
      ...entry,
      outwardNo: entry.outward_no,
      partyType: entry.party_type,
      customerName: entry.customer_name,
      vendorName: entry.vendor_name,
      processName: entry.process_name,
      invoiceReference: entry.invoice_reference,
      challanNo: entry.challan_no,
      vehicleNo: entry.vehicle_no,
      driverName: entry.driver_name,
      companyId: entry.company_id,
      inwardId: entry.inward_id,
      inwardNo: entry.inward_no,
      createdAt: entry.created_at,
      items: JSON.parse(entry.items_json || '[]')
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch outward entry details', detail: error.message });
  }
};

export const getPendingOutwardsByVendor = async (req: AuthRequest, res: Response) => {
  const vendorId = String(req.params.vendorId);
  const user = req.user;
  const companyId = user?.company_id;

  try {
    // 1. Find all outwards for this vendor
    const outwards = await prisma.outwardEntry.findMany({
      where: {
        AND: [
          { company_id: String(companyId) },
          { vendor_id: String(vendorId) },
          { party_type: 'vendor' }
        ]
      }
    });

    // 2. Get all related inwards to calculate what's been returned
    const relatedInwards = await prisma.inwardEntry.findMany({
      where: {
        outward_id: { in: outwards.map(o => o.id) }
      }
    });

    // Pre-group for O(1) lookup
    const inwardGroups = new Map<string, any[]>();
    relatedInwards.forEach((inw: any) => {
      const gid = String(inw.outward_id);
      if (!inwardGroups.has(gid)) inwardGroups.set(gid, []);
      inwardGroups.get(gid)!.push(inw);
    });

    const results = outwards.map(entry => {
      const originalItems = JSON.parse(entry.items_json || '[]');
      const returnedInwards = inwardGroups.get(String(entry.id)) || [];

      const balanceItems = originalItems.map((item: any) => {
        let totalReturnedQty = 0;
        const itemIdentifier = (item.description || item.item_name || '').toLowerCase();

        returnedInwards.forEach((inw: any) => {
          const inwItems = JSON.parse(inw.items_json || '[]');
          const matchingItem = inwItems.find((ii: any) => (ii.description || ii.item_name || '').toLowerCase() === itemIdentifier);
          if (matchingItem) {
            totalReturnedQty += parseFloat(matchingItem.quantity || matchingItem.qty || '0');
          }
        });

        const original = parseFloat(item.quantity || item.qty || '0');
        const rem = Math.max(0, original - totalReturnedQty);

        return {
          ...item,
          originalQty: original,
          returnedQty: totalReturnedQty,
          remainingQty: rem
        };
      });

      const hasBalance = balanceItems.some((item: any) => item.remainingQty > 0);

      return {
        id: entry.id,
        outwardNo: entry.outward_no,
        vendorName: entry.vendor_name,
        date: entry.date,
        processName: entry.process_name,
        challanNo: entry.challan_no,
        status: entry.status,
        items: balanceItems,
        totalRemaining: balanceItems.reduce((acc: number, cur: any) => acc + cur.remainingQty, 0),
        hasBalance
      };
    }).filter(r => r.hasBalance);

    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to calculate outward balance', detail: error.message });
  }
};
