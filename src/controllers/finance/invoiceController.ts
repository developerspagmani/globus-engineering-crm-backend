import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import { logAudit } from '../../utils/auditLogger';
import crypto from 'crypto';

export const getAllInvoices = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const user = req.user;

  // 1. Determine CompanyID - Support User context AND Direct Query Param (Snake and Camel)
  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: companyId ? { 
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() }
        ]
      } : {},
      orderBy: { invoice_date: 'desc' }
    });

    const parsedInvoices = invoices.map((inv: any) => {
      const base = { ...inv };
      const mapped = {
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
        subTotal: parseFloat(inv.total || '0'),
        grandTotal: parseFloat(inv.grand_total || '0'),
        discount: parseFloat(inv.discount || '0'),
        gstin: inv.gstin || '',
        state: inv.state || '',
        status: inv.status || 'DRAFT'
      };
      return mapped;
    });

    res.json(parsedInvoices);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch invoices', detail: error.message });
  }
};

export const createInvoice = async (req: AuthRequest, res: Response) => {
  const {
    invoiceNumber, date, dueDate, customerId, customerName,
    address, subTotal, grandTotal, items, billType, inwardId, company_id, companyId, notes,
    po_no, po_date, dc_no, dc_date, poNo, poDate, dcNo, dcDate, gstin, state
  } = req.body;
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
          customer_id: customerId ? parseInt(String(customerId)) : null,
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
          notes: notes || ''
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
              party_name: customerName,
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
          partyId: String(customerId),
          company_id: finalCompanyId ? String(finalCompanyId) : undefined
        },
        orderBy: { createdAt: 'desc' }
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
          partyId: String(customerId),
          partyName: customerName,
          partyType: 'customer',
          company_id: finalCompanyId ? String(finalCompanyId) : null,
          date: date ? new Date(date) : new Date(),
          vchType: 'INVOICE',
          vchNo: String(newInvoice.invoice_no || newInvoice.id),
          type: 'debit',
          amount: amountAsFloat,
          balance: newBalance,
          description: `Invoice: ${newInvoice.invoice_no || newInvoice.id} (Qty: ${totalQty})`,
          referenceNo: String(newInvoice.id)
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
    address, subTotal, grandTotal, items, billType, inwardId, status, notes, gstin, state
  } = req.body;

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
        notes: notes
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
