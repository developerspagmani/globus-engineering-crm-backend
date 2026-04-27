import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getOutwardEntries = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.companyId || req.query.company_id) as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const entries = await prisma.outwardEntry.findMany({
      where: companyId ? { 
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() }
        ]
      } : {},
      orderBy: [
        { date: 'desc' },
        { created_at: 'desc' }
      ]
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
  
  const finalOutwardNo = String(outward_no || outwardNo || '');
  const finalPartyType = String(party_type || partyType || 'customer');
  const finalCustomerId = String(customer_id || customerId || '');
  const finalCustomerName = String(customer_name || customerName || '');
  const finalVendorId = String(vendor_id || vendorId || '');
  const finalVendorName = String(vendor_name || vendorName || '');
  const finalProcessName = String(process_name || processName || '');
  const finalCompanyId = user?.role === 'super_admin' ? (company_id || companyId) : user?.company_id;
  const finalInwardId = String(inward_id || inwardId || '');
  const finalInwardNo = String(inward_no || inwardNo || '');

  // Sanitize numeric amount to prevent NaN
  const rawAmount = req.body.amount || 0;
  const finalAmount = isNaN(parseFloat(String(rawAmount))) ? 0 : parseFloat(String(rawAmount));

  try {
    // Explicitly check if the model exists to avoid "undefined" crashes
    if (!(prisma as any).outwardEntry) {
      throw new Error("Prisma model 'outwardEntry' is not initialized in the client.");
    }

    const entry = await (prisma as any).outwardEntry.create({
      data: {
        id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
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
        company_id: finalCompanyId ? String(finalCompanyId) : null,
        inward_id: finalInwardId,
        inward_no: finalInwardNo,
        status: status || 'completed',
        amount: finalAmount,
        items_json: JSON.stringify(items || []),
        date: new Date()
      }
    });

    // 2. AUTOMATIC LEDGER ENTRY FOR VENDOR JOB WORK
    if (finalPartyType.toLowerCase() === 'vendor' && finalVendorId && finalVendorId !== 'undefined' && finalVendorId !== '') {
       if (finalAmount > 0) {
          // Find last balance for the vendor
          const lastLedger = await (prisma as any).ledgerEntry.findFirst({
             where: { party_id: finalVendorId, company_id: finalCompanyId ? String(finalCompanyId) : undefined },
             orderBy: { created_at: 'desc' }
          });
          const lastBalance = lastLedger ? parseFloat(String(lastLedger.balance || '0')) : 0;
          const newBalance = (isNaN(lastBalance) ? 0 : lastBalance) - finalAmount;

          const totalQty = (items || []).reduce((acc: number, cur: any) => acc + (parseFloat(cur.quantity) || 0), 0);

          await (prisma as any).ledgerEntry.create({
             data: {
<<<<<<< HEAD
                id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
                party_id: finalVendorId,
                party_name: finalVendorName || 'N/A',
=======
                id: crypto.randomUUID(),
                party_id: String(finalVendorId),
                party_name: String(finalVendorName || 'N/A'),
>>>>>>> 02f3777fc8bd360cdd1b954db5da4bb3f2bd857e
                party_type: 'vendor',
                company_id: finalCompanyId ? String(finalCompanyId) : null,
                date: new Date(),
                vch_type: 'OUTWARD',
                vch_no: String(finalOutwardNo || ''),
                type: 'debit',
                amount: finalAmount,
                balance: newBalance,
                description: `Job Work Dispatch: ${finalProcessName || 'Processing'} (Qty: ${totalQty})`,
                reference_id: String(entry.id)
             }
          });
       }
    }

    res.status(201).json({
      ...entry,
      items: JSON.parse((entry as any).items_json || '[]')
    });
  } catch (error: any) {
    console.error('CREATE_OUTWARD_ERROR:', error);
    res.status(500).json({ 
      error: 'Failed to create outward entry', 
      detail: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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

  const finalOutwardNo = String(outward_no || outwardNo || '');
  const finalPartyType = String(party_type || partyType || 'customer');
  const finalVendorId = String(vendor_id || vendorId || '');
  const finalVendorName = String(vendor_name || vendorName || '');
  const finalProcessName = String(process_name || processName || '');

  // Sanitize numeric amount
  const rawAmount = req.body.amount || 0;
  const finalAmount = isNaN(parseFloat(String(rawAmount))) ? 0 : parseFloat(String(rawAmount));

  try {
    const entry = await (prisma as any).outwardEntry.update({
      where: { id: String(id) },
      data: {
        outward_no: finalOutwardNo,
        party_type: finalPartyType,
        customer_id: String(customer_id || customerId || ''),
        customer_name: String(customer_name || customerName || ''),
        vendor_id: finalVendorId,
        vendor_name: finalVendorName,
        process_name: finalProcessName,
        invoice_reference: String(invoice_reference || invoiceReference || ''),
        challan_no: String(challan_no || challanNo || ''),
        vehicle_no: String(vehicle_no || vehicleNo || ''),
        driver_name: String(driver_name || driverName || ''),
        notes: String(notes || ''),
        status: status,
        items_json: items ? JSON.stringify(items) : undefined,
        amount: finalAmount,
      }
    });

    // 2. AUTOMATIC LEDGER SYNC FOR UPDATE
    const user = req.user;
    const finalCompanyId = user?.company_id || entry.company_id;

    if (finalPartyType.toLowerCase() === 'vendor' && finalVendorId && finalVendorId !== 'undefined' && finalAmount > 0) {
       const existingLedger = await (prisma as any).ledgerEntry.findFirst({
          where: { reference_id: String(entry.id) }
       });

       const totalQty = (items || JSON.parse(entry.items_json || '[]')).reduce((acc: number, cur: any) => acc + (parseFloat(cur.quantity) || 0), 0);

       if (existingLedger) {
          await (prisma as any).ledgerEntry.update({
             where: { id: existingLedger.id },
             data: {
                amount: finalAmount,
                vch_no: finalOutwardNo,
                description: `Job Work Dispatch: ${finalProcessName || 'Processing'} (Qty: ${totalQty})`
             }
          });
       } else {
          // Create new ledger entry if missing
          const lastLedger = await (prisma as any).ledgerEntry.findFirst({
             where: { party_id: finalVendorId, company_id: finalCompanyId ? String(finalCompanyId) : undefined },
             orderBy: { created_at: 'desc' }
          });
          const lastBalance = lastLedger ? parseFloat(String(lastLedger.balance || '0')) : 0;
          const newBalance = (isNaN(lastBalance) ? 0 : lastBalance) - finalAmount;

          await (prisma as any).ledgerEntry.create({
             data: {
<<<<<<< HEAD
                id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
                party_id: finalVendorId,
                party_name: finalVendorName || 'N/A',
=======
                id: crypto.randomUUID(),
                party_id: String(finalVendorId),
                party_name: String(finalVendorName || 'N/A'),
>>>>>>> 02f3777fc8bd360cdd1b954db5da4bb3f2bd857e
                party_type: 'vendor',
                company_id: finalCompanyId ? String(finalCompanyId) : null,
                date: new Date(),
                vch_type: 'OUTWARD',
<<<<<<< HEAD
                vch_no: finalOutwardNo,
=======
                vch_no: String(finalOutwardNo || (entry as any).outward_no || ''),
>>>>>>> 02f3777fc8bd360cdd1b954db5da4bb3f2bd857e
                type: 'debit',
                amount: finalAmount,
                balance: newBalance,
                description: `Job Work Dispatch: ${finalProcessName || 'Processing'} (Qty: ${totalQty})`,
                reference_id: String(entry.id)
             }
          });
       }
    }

    res.json({
      ...entry,
      items: JSON.parse((entry as any).items_json || '[]')
    });
  } catch (error: any) {
    console.error('UPDATE_OUTWARD_ERROR:', error);
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
