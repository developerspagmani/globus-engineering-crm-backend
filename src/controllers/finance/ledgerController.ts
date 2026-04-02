import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getLedgerEntries = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const partyId = req.query.partyId as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        AND: [
          companyId ? {
            OR: [
              { company_id: String(companyId) },
              { company_id: String(companyId).toLowerCase() }
            ]
          } : {},
          partyId ? { party_id: String(partyId) } : {}
        ]
      },
      orderBy: { created_at: 'desc' }
    });
    res.json(entries);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch ledger entries', detail: error.message });
  }
};

export const createLedgerEntry = async (req: AuthRequest, res: Response) => {
  const { partyId, partyName, partyType, date, type, amount, description, referenceId, companyId, company_id } = req.body;
  const user = req.user;
  const rawCompanyId = company_id || companyId || user?.company_id || (user as any)?.companyId;
  const finalCompanyId = rawCompanyId ? String(rawCompanyId).toLowerCase() : null;

  try {
    const finalAmount = parseFloat(String(amount || '0'));
    const finalType = (type || 'credit').toLowerCase();
    const entryDate = date || new Date();

    // 1. FIND THE PREVIOUS BALANCE
    const lastEntry = await prisma.ledgerEntry.findFirst({
        where: {
            party_id: String(partyId),
            company_id: finalCompanyId ? String(finalCompanyId) : undefined
        },
        orderBy: { created_at: 'desc' }
    });

    const lastBalance = lastEntry ? parseFloat(String((lastEntry as any).balance || '0')) : 0;
    
    // 2. CALCULATE NEW BALANCE
    // Debit (+) adds to balance, Credit (-) subtracts from balance
    const newBalance = finalType === 'debit' ? (lastBalance + finalAmount) : (lastBalance - finalAmount);

    const entry = await prisma.$transaction(async (tx) => {
      const newEntry = await (tx as any).ledgerEntry.create({
        data: {
          id: crypto.randomUUID(),
          party_id: String(partyId),
          party_name: partyName || 'N/A',
          party_type: partyType || 'customer',
          company_id: finalCompanyId ? String(finalCompanyId) : null,
          date: new Date(entryDate),
          type: finalType,
          amount: finalAmount,
          balance: newBalance,
          description: description || '',
          reference_id: referenceId || '',
        }
      });

      // 3. FIFO AUTO-RECONCILIATION: Pay off oldest invoices if this is a customer credit
      if (finalType === 'credit' && (partyType || 'customer').toLowerCase() === 'customer') {
        const pendingInvoices = await (tx as any).legacyInvoice.findMany({
          where: {
            customer_id: parseInt(String(partyId)),
            status: { not: 'PAID' },
            company_id: finalCompanyId
          },
          orderBy: { invoice_date: 'asc' }
        });

        let remainingToApply = finalAmount;
        for (const inv of pendingInvoices) {
            if (remainingToApply <= 0) break;
            const grandTotal = parseFloat(inv.grand_total || '0');
            const paidAmount = parseFloat(inv.paid_amount || '0');
            const balanceDue = grandTotal - paidAmount;
            
            if (balanceDue <= 0) continue;

            const application = Math.min(remainingToApply, balanceDue);
            const newPaidTotal = paidAmount + application;

            await (tx as any).legacyInvoice.update({
                where: { id: inv.id },
                data: {
                    paid_amount: String(newPaidTotal),
                    status: newPaidTotal >= grandTotal ? 'PAID' : 'BILLED'
                }
            });
            remainingToApply -= application;
        }
      }

      return newEntry;
    });

    res.status(201).json(entry);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to add ledger entry', detail: error.message });
  }
};
