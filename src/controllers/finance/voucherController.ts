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
  const { id, voucher_no, date, type, party_id, party_name, party_type, amount, payment_mode, reference_no, cheque_no, description, company_id, status } = req.body;
  const user = req.user;
  const finalCompanyId = company_id || user?.company_id || (user as any)?.companyId;

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
      if (type === 'receipt' && party_type === 'customer' && reference_no) {
        const invNumbers = String(reference_no).split(',').map((s: string) => s.trim()).filter(Boolean);
        
        if (invNumbers.length > 0) {
          const invNumsAsInts = invNumbers.map((n: string) => {
            const onlyDigits = n.replace(/\D/g, '');
            return onlyDigits ? parseInt(onlyDigits, 10) : NaN;
          }).filter((n: number) => !isNaN(n));

          const invoices = await (tx as any).legacyInvoice.findMany({
            where: {
              OR: [
                { id: { in: invNumsAsInts } },
                { invoice_no: { in: invNumsAsInts } },
                { dc_no: { in: invNumbers } }
              ],
              company_id: finalCompanyId ? String(finalCompanyId) : undefined
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

        const lastEntry = await tx.ledgerEntry.findFirst({
          where: {
            party_id: String(party_id),
            company_id: finalCompanyId ? String(finalCompanyId) : undefined
          },
          orderBy: { created_at: 'desc' }
        });

        const lastBalance = lastEntry ? (lastEntry.balance || 0) : 0;
        const newBalance = type === 'receipt' ? lastBalance - finalAmount : lastBalance + finalAmount;

        await tx.ledgerEntry.create({
          data: {
            id: crypto.randomUUID(),
            party_id: String(party_id),
            party_name: party_name,
            party_type: party_type || 'customer',
            company_id: finalCompanyId ? String(finalCompanyId) : null,
            date: date ? new Date(date) : new Date(),
            type: type === 'receipt' ? 'credit' : 'debit',
            amount: finalAmount,
            balance: newBalance,
            description: `Payment Receipt: ${voucher.voucher_no} for Invoices: ${reference_no}`,
            reference_id: voucher.voucher_no
          } as any
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
