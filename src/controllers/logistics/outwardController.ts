import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getOutwardEntries = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const entries = await prisma.outwardEntry.findMany({
      where: companyId ? { company_id: String(companyId) } : {}
    });
    
    const parsedEntries = entries.map((e: any) => ({
      ...e,
      items: JSON.parse(e.items_json || '[]')
    }));
    
    res.json(parsedEntries);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch outward entries', detail: error.message });
  }
};

export const createOutwardEntry = async (req: AuthRequest, res: Response) => {
  const { 
    outward_no, party_type, customer_id, customer_name, vendor_id, vendor_name, process_name, invoice_reference, challan_no, vehicle_no, driver_name, notes, status, items, company_id, inward_id, inward_no
  } = req.body;
  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? company_id : user?.company_id;

  try {
    const entry = await (prisma.outwardEntry as any).create({
      data: {
        id: crypto.randomUUID(),
        outward_no,
        party_type: party_type || 'customer',
        customer_id,
        customer_name,
        vendor_id,
        vendor_name,
        process_name,
        invoice_reference: String(invoice_reference || ''),
        challan_no: String(challan_no || ''),
        vehicle_no: String(vehicle_no || ''),
        driver_name: String(driver_name || ''),
        notes: String(notes || ''),
        company_id: finalCompanyId,
        inward_id: String(inward_id || ''),
        inward_no: String(inward_no || ''),
        status: status || 'completed',
        amount: parseFloat(String(req.body.amount || '0')),
        items_json: JSON.stringify(items || []),
        date: new Date()
      }
    });

    // 2. AUTOMATIC LEDGER ENTRY FOR VENDOR JOB WORK
    if ((party_type || 'customer').toLowerCase() === 'vendor' && vendor_id) {
       const jobValue = parseFloat(String(req.body.amount || '0'));
       if (jobValue > 0) {
          // Find last balance for the vendor
          const lastLedger = await prisma.ledgerEntry.findFirst({
             where: { party_id: String(vendor_id), company_id: finalCompanyId },
             orderBy: { created_at: 'desc' }
          });
          const lastBalance = lastLedger ? parseFloat(String((lastLedger as any).balance || '0')) : 0;
          
          // Vendor Ledger (Liability): Balance = Old + Credit - Debit
          // Sending goods to vendor is a DEBIT (reduces our liability or records their possession)
          const newBalance = lastBalance - jobValue;

          const totalQty = JSON.parse(entry.items_json || '[]').reduce((acc: number, cur: any) => acc + (parseFloat(cur.quantity) || 0), 0);

          await (prisma.ledgerEntry as any).create({
             data: {
                id: crypto.randomUUID(),
                party_id: String(vendor_id),
                party_name: vendor_name || 'N/A',
                party_type: 'vendor',
                company_id: finalCompanyId,
                date: new Date(),
                vch_type: 'OUTWARD',
                vch_no: outward_no,
                type: 'debit',
                amount: jobValue,
                balance: newBalance,
                description: `Job Work Dispatch: ${process_name || 'Processing'} (Qty: ${totalQty})`,
                reference_id: entry.id
             }
          });
       }
    }

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
    outward_no, party_type, customer_id, customer_name, vendor_id, vendor_name, process_name, invoice_reference, challan_no, vehicle_no, driver_name, notes, status, items 
  } = req.body;

  try {
    const entry = await (prisma.outwardEntry as any).update({
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

    // 2. AUTOMATIC LEDGER SYNC FOR UPDATE
    const jobValue = parseFloat(String(req.body.amount || '0'));
    const user = req.user;
    const finalCompanyId = user?.company_id || entry.company_id;

    if ((party_type || 'customer').toLowerCase() === 'vendor' && vendor_id && jobValue > 0) {
       const existingLedger = await (prisma.ledgerEntry as any).findFirst({
          where: { reference_id: String(entry.id) }
       });

       const totalQty = JSON.parse(entry.items_json || '[]').reduce((acc: number, cur: any) => acc + (parseFloat(cur.quantity) || 0), 0);

       if (existingLedger) {
          await (prisma.ledgerEntry as any).update({
             where: { id: existingLedger.id },
             data: {
                amount: jobValue,
                vch_no: outward_no || String((entry as any).outward_no || ''),
                description: `Job Work Dispatch: ${process_name || 'Processing'} (Qty: ${totalQty})`
             }
          });
       } else {
          // Create new ledger entry if missing
          const lastLedger = await (prisma.ledgerEntry as any).findFirst({
             where: { party_id: String(vendor_id), company_id: finalCompanyId },
             orderBy: { created_at: 'desc' }
          });
          const lastBalance = lastLedger ? (lastLedger.balance || 0) : 0;
          const newBalance = lastBalance - jobValue;

          await (prisma.ledgerEntry as any).create({
             data: {
                id: crypto.randomUUID(),
                party_id: String(vendor_id),
                party_name: vendor_name || 'N/A',
                party_type: 'vendor',
                company_id: finalCompanyId,
                date: new Date(),
                vch_type: 'OUTWARD',
                vch_no: outward_no || String((entry as any).outward_no || ''),
                type: 'debit',
                amount: jobValue,
                balance: newBalance,
                description: `Job Work Dispatch: ${process_name || 'Processing'} (Qty: ${totalQty})`,
                reference_id: entry.id
             }
          });
       }
    }

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
