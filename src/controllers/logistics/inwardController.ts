import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getInwardEntries = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.companyId || req.query.company_id) as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId);

  try {
    const entries = await prisma.inwardEntry.findMany({
      where: companyId ? {
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() },
          { company_id: String(companyId).toUpperCase() }
        ]
      } : {},
      orderBy: [
        { date: 'desc' },
        { created_at: 'desc' }
      ]
    });

    // Fetch all related invoices and outwards to calculate balances in bulk
    const inwardIds = entries.map(e => e.id);
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: { inward_id: { in: inwardIds } }
    });
    const outwards = await prisma.outwardEntry.findMany({
      where: { inward_id: { in: inwardIds } }
    });

    // Pre-group invoices and outwards for O(1) lookup speed
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
        let totalDeducted = 0;
        const itemIdentifier = (item.description || item.item_name || '').toLowerCase();

        // Add Invoiced quantities
        invoicedForThisEntry.forEach((inv: any) => {
          const invItems = JSON.parse(inv.items_json || '[]');
          const matchingItem = invItems.find((ii: any) => (ii.description || ii.item_name || '').toLowerCase() === itemIdentifier);
          if (matchingItem) {
            totalDeducted += (parseFloat(matchingItem.qty || matchingItem.quantity || '0') + parseFloat(matchingItem.wopQty || matchingItem.wop_qty || '0'));
          }
        });

        // Add Outward quantities
        outwardsForThisEntry.forEach((ow: any) => {
          const owItems = JSON.parse(ow.items_json || '[]');
          const matchingItem = owItems.find((oi: any) => (oi.description || oi.item_name || '').toLowerCase() === itemIdentifier);
          if (matchingItem) {
            totalDeducted += parseFloat(matchingItem.quantity || matchingItem.qty || '0');
          }
        });

        const originalQty = parseFloat(item.quantity || item.qty || '0');
        return {
          ...item,
          originalQty,
          deductedQty: totalDeducted,
          remainingQty: Math.max(0, originalQty - totalDeducted)
        };
      });

      return {
        ...e,
        customerName: e.customer_name, // Use the repaired column
        items: balanceItems,
        totalRemaining: balanceItems.reduce((acc: number, cur: any) => acc + cur.remainingQty, 0)
      };
    });

    res.json(parsedEntries);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch inward entries with balance', detail: error.message });
  }
};

export const createInwardEntry = async (req: AuthRequest, res: Response) => {
  const {
    inward_no, customer_id, customer_name, address, vendor_id, vendor_name,
    po_reference, po_date, challan_no, dc_no, dc_date, due_date, vehicle_no, status, items, company_id, companyId
  } = req.body;
  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? (company_id || companyId) : (user?.company_id || company_id || companyId);

  try {
    const entry = await prisma.inwardEntry.create({
      data: {
        id: crypto.randomUUID(),
        inward_no,
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
        date: new Date()
      }
    });

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
    po_reference, po_date, challan_no, dc_no, dc_date, due_date, vehicle_no, status, items
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
        const itemIdentifier = (item.description || item.item_name || '').toLowerCase();

        invoicedForThisEntry.forEach((inv: any) => {
          const invItems = JSON.parse(inv.items_json || '[]');
          const matchingItem = invItems.find((ii: any) => (ii.description || ii.item_name || '').toLowerCase() === itemIdentifier);
          if (matchingItem) {
            const q = parseFloat(matchingItem.qty || matchingItem.quantity || '0');
            const w = parseFloat(matchingItem.wopQty || matchingItem.wop_qty || '0');
            totalInvoicedQty += (q + w);
          }
        });

        let totalSentToVendorQty = 0;
        outwardsForThisEntry.forEach((ow: any) => {
          const owItems = JSON.parse(ow.items_json || '[]');
          const matchingItem = owItems.find((oi: any) => (oi.description || oi.item_name || '').toLowerCase() === itemIdentifier);
          if (matchingItem) {
            totalSentToVendorQty += parseFloat(matchingItem.quantity || matchingItem.qty || '0');
          }
        });

        const original = parseFloat(item.quantity || item.qty || '0');
        const inHouse = original - totalInvoicedQty - totalSentToVendorQty;
        const rem = Math.max(0, inHouse);

        return {
          ...item,
          originalQty: original,
          invoicedQty: totalInvoicedQty,
          sentToVendor: totalSentToVendorQty,
          remainingQty: rem,
          inHouseQty: rem
        };
      });

      const hasBalance = balanceItems.some((item: any) => item.remainingQty > 0);
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
