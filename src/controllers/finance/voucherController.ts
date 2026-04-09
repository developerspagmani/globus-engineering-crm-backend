import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getAllVouchers = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const vouchers = await prisma.voucher.findMany({
      where: companyId ? { 
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() }
        ]
      } : {},
      orderBy: { date: 'desc' }
    });
    res.json(vouchers);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch vouchers', detail: error.message });
  }
};

export const createVoucher = async (req: AuthRequest, res: Response) => {
  const { id, voucher_no, date, type, party_id, party_name, party_type, amount, payment_mode, reference_no, cheque_no, description, company_id, companyId, status } = req.body;
  const user = req.user;
  const rawCompanyId = company_id || companyId || user?.company_id || (user as any)?.companyId;
  const finalCompanyId = rawCompanyId ? String(rawCompanyId).toLowerCase() : null;

  try {
    const finalAmount = parseFloat(String(amount || '0'));
    const finalId = (id && id.trim() !== '') ? id : crypto.randomUUID();

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the Voucher
      const voucher = await (tx.voucher as any).create({
        data: {
          id: finalId,
          voucher_no: voucher_no || `VCH-${Date.now()}`,
          date: date ? new Date(date) : new Date(),
          type: type || 'receipt',
          party_id: party_id ? String(party_id) : null,
          party_name: party_name || '',
          party_type: party_type || 'customer',
          amount: finalAmount,
          payment_mode: payment_mode || 'cash',
          reference_no: reference_no || '',
          cheque_no: cheque_no || '',
          description_: description || '',
          company_id: finalCompanyId ? String(finalCompanyId) : null,
          status: status || 'posted'
        }
      });

      // 2. If it's a receipt from a customer, update the Invoice and Ledger
      if (type === 'receipt' && party_type === 'customer') {
        const invNumbers = reference_no ? String(reference_no).split(',').map((s: string) => s.trim()).filter(Boolean) : [];
        
        if (invNumbers.length > 0) {
          // ... (existing invoice status update logic is fine, keeping it for auto-reconciliation)
          const invNumsAsInts = invNumbers.map((n: string) => {
            const onlyDigits = n.replace(/\D/g, '');
            return onlyDigits ? parseInt(onlyDigits, 10) : NaN;
          }).filter((n: number) => !isNaN(n));

          const invoices = await (tx as any).legacyInvoice.findMany({
            where: {
              AND: [
                {
                  OR: [
                    { id: { in: invNumsAsInts } },
                    { invoice_no: { in: invNumsAsInts } },
                    { dc_no: { in: invNumbers } }
                  ]
                },
                {
                  OR: [
                    { company_id: finalCompanyId ? String(finalCompanyId) : undefined },
                    { company_id: finalCompanyId ? String(finalCompanyId).toLowerCase() : undefined }
                  ]
                }
              ]
            }
          });

          let remainingAmount = finalAmount;
          for (const inv of invoices) {
            if (remainingAmount <= 0) break;
            const currentGrandTotal = parseFloat(inv.grand_total || '0');
            const currentPaidAmount = parseFloat(inv.paid_amount || '0');
            const balanceDue = currentGrandTotal - currentPaidAmount;
            if (balanceDue <= 0) continue;

            const paymentForThisInvoice = Math.min(remainingAmount, balanceDue);
            const newPaidAmount = currentPaidAmount + paymentForThisInvoice;
            
            await (tx as any).legacyInvoice.update({
              where: { id: inv.id },
              data: {
                paid_amount: String(newPaidAmount),
                status: newPaidAmount >= currentGrandTotal ? 'PAID' : 'BILLED'
              }
            });
            remainingAmount -= paymentForThisInvoice;
          }
        }
      }

      // 3. UPDATE LEDGER (For both Customers and Vendors)
      if (party_id) {
        const lastEntry = await (tx.ledgerEntry as any).findFirst({
           where: {
             party_id: String(party_id),
             company_id: finalCompanyId ? String(finalCompanyId) : undefined
           },
           orderBy: { created_at: 'desc' }
        });

        const lastBalance = lastEntry ? (lastEntry.balance || 0) : 0;
        const isReceipt = type === 'receipt'; // Receipt (Credit for Cust, Debit for Vendor?? No, Receipt is money in)
        
        // Accounting Logic for Vouchers:
        // Customer Receipt: Bal - Amt (Credit)
        // Vendor Payment: Bal - Amt (Debit) -> Wait, if we owe vendor 1000 (Cr) and pay 200 (Dr), bal becomes 800 (Cr).
        // Standardizing: 
        // Customer: Receipt = Credit (-), Invoice = Debit (+)
        // Vendor: Payment = Debit (-), Purchase = Credit (+)
        
        const change = finalAmount;
        const newBalance = lastBalance - change; 

        await (tx.ledgerEntry as any).create({
          data: {
            id: crypto.randomUUID(),
            party_id: String(party_id),
            party_name: party_name || 'N/A',
            party_type: party_type || 'customer',
            company_id: finalCompanyId ? String(finalCompanyId) : null,
            date: date ? new Date(date) : new Date(),
            vch_type: type.toUpperCase(), // RECEIPT or PAYMENT
            vch_no: voucher.voucher_no || voucher.id,
            type: type === 'receipt' ? 'credit' : 'debit',
            amount: finalAmount,
            balance: newBalance,
            description: `${type.charAt(0).toUpperCase() + type.slice(1)}: ${payment_mode.toUpperCase()} ${cheque_no ? `(CHQ: ${cheque_no})` : ''} ${reference_no ? `Ref: ${reference_no}` : ''}`,
            reference_id: voucher.voucher_no || voucher.id
          }
        });
      }

      return voucher;
    });

    res.status(201).json(result);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create voucher', message: error.message });
  }
};

export const updateVoucher = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { voucher_no, date, type, party_id, party_name, party_type, amount, payment_mode, reference_no, cheque_no, description, status } = req.body;
  try {
    const voucher = await prisma.voucher.update({
      where: { id: String(id) },
      data: {
        voucher_no,
        date: date ? new Date(date) : undefined,
        type,
        party_id,
        party_name,
        party_type,
        amount: amount ? parseFloat(String(amount)) : undefined,
        payment_mode,
        reference_no,
        cheque_no,
        description_: description,
        status: status?.toLowerCase()
      }
    });
    res.json(voucher);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update voucher', detail: error.message });
  }
};

export const deleteVoucher = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.voucher.delete({ where: { id: String(id) } });
    res.json({ message: 'Voucher deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete voucher', detail: error.message });
  }
};
