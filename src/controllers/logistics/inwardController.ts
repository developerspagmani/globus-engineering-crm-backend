import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getInwardEntries = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const entries = await prisma.inwardEntry.findMany({
      where: companyId ? { company_id: String(companyId) } : {}
    });
    
    const parsedEntries = entries.map((e: any) => ({
      ...e,
      items: JSON.parse(e.items_json || '[]')
    }));
    
    res.json(parsedEntries);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch inward entries', detail: error.message });
  }
};

export const createInwardEntry = async (req: AuthRequest, res: Response) => {
  const { 
    inward_no, customer_id, customer_name, address, vendor_id, vendor_name, 
    po_reference, po_date, challan_no, dc_no, dc_date, vehicle_no, status, items, company_id, companyId 
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
    po_reference, po_date, challan_no, dc_no, dc_date, vehicle_no, status, items 
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
        OR: [
          { customer_id: { contains: String(customerId) } },
          { customer_name: { contains: String(customerId) } },
          { customer_name: { contains: nameToSearch } }
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

    // console.log(`[DIAGNOSTIC] Related Invoices found: ${relatedInvoices.length}`);

    const results = inwards.map(entry => {
      const originalItems = JSON.parse(entry.items_json || '[]');
      const invoicedForThisEntry = relatedInvoices.filter((inv: any) => inv.inward_id === entry.id);
      
      const balanceItems = originalItems.map((item: any) => {
        let totalInvoicedQty = 0;
        invoicedForThisEntry.forEach((inv: any) => {
          const invItems = JSON.parse(inv.items_json || '[]');
          const matchingItem = invItems.find((ii: any) => ii.item_name === item.item_name || ii.id === item.id || (ii.description === item.description));
          if (matchingItem) {
            totalInvoicedQty += parseFloat(matchingItem.qty || matchingItem.quantity || '0');
          }
        });

        const rem = parseFloat(item.quantity || item.qty || '0') - totalInvoicedQty;
        return {
          ...item,
          originalQty: parseFloat(item.quantity || item.qty || '0'),
          invoicedQty: totalInvoicedQty,
          remainingQty: rem
        };
      });

      const hasBalance = balanceItems.some((item: any) => item.remainingQty > 0);
      // console.log(`[DIAGNOSTIC] Inward #${entry.inward_no}: hasBalance=${hasBalance}, Items=${balanceItems.length}`);

      return {
        id: entry.id,
        inward_no: entry.inward_no,
        date: entry.date,
        po_reference: entry.po_reference,
        po_date: entry.po_date,
        dc_no: entry.dc_no,
        dc_date: entry.dc_date,
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
