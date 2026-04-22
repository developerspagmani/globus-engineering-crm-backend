import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getLedgerEntries = async (req: AuthRequest, res: Response) => {
  const { partyId, companyId: queryCompanyId } = req.query;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const entries = await (prisma.ledgerEntry as any).findMany({
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
      orderBy: [
        { date: 'asc' },
        { created_at: 'asc' }
      ]
    });
    res.json(entries);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch ledger entries', detail: error.message });
  }
};

export const createLedgerEntry = async (req: AuthRequest, res: Response) => {
  const { 
    partyId, partyName, partyType, date, type, amount, description, referenceId, linkedInvoiceId, company_id, companyId 
  } = req.body;
  const user = req.user;
  const vchType = req.body.vchType || 'MANUAL';
  const vchNo = req.body.vchNo || referenceId;

  const rawCompanyId = company_id || companyId || user?.company_id || (user as any)?.companyId;
  const finalCompanyId = rawCompanyId ? String(rawCompanyId).toLowerCase() : null;

  try {
    const finalAmount = parseFloat(String(amount || '0'));
    const finalType = (type || 'credit').toLowerCase();
    const isVendor = (partyType || 'customer').toLowerCase() === 'vendor';
    const entryDate = date || new Date();

    // 1. FIND THE PREVIOUS BALANCE
    const lastEntry = await (prisma.ledgerEntry as any).findFirst({
        where: {
            party_id: String(partyId),
            company_id: finalCompanyId ? String(finalCompanyId) : undefined
        },
        orderBy: { created_at: 'desc' }
    });

    const lastBalance = lastEntry ? (lastEntry.balance || 0) : 0;
    
    // 2. CALCULATE NEW BALANCE
    let newBalance = lastBalance;
    if (isVendor) {
      newBalance = finalType === 'credit' ? (lastBalance + finalAmount) : (lastBalance - finalAmount);
    } else {
      newBalance = finalType === 'debit' ? (lastBalance + finalAmount) : (lastBalance - finalAmount);
    }

    const entry = await prisma.$transaction(async (tx) => {
      const newEntry = await (tx.ledgerEntry as any).create({
        data: {
          id: crypto.randomUUID(),
          party_id: String(partyId),
          party_name: partyName || 'N/A',
          party_type: partyType || 'customer',
          company_id: finalCompanyId ? String(finalCompanyId) : null,
          date: new Date(entryDate),
          vch_type: vchType,
          vch_no: linkedInvoiceId ? String(linkedInvoiceId) : vchNo,
          type: finalType,
          amount: finalAmount,
          balance: newBalance,
          description: description || '',
          reference_id: referenceId || '',
        }
      });

      // 3. RECONCILIATION
      if (linkedInvoiceId || finalType === 'credit') {
        const isCustomer = (partyType || 'customer').toLowerCase() === 'customer';
        
        if (isCustomer && finalType === 'credit') {
          let remainingToApply = finalAmount;

          // A. Priority: Linked Invoice
          if (linkedInvoiceId) {
            const targetInv = await (tx as any).legacyInvoice.findUnique({
              where: { id: parseInt(String(linkedInvoiceId)) }
            });

            if (targetInv && targetInv.status !== 'PAID') {
              const grandTotal = parseFloat(targetInv.grand_total || '0');
              const paidAmount = parseFloat(targetInv.paid_amount || '0');
              const balanceDue = grandTotal - paidAmount;

              if (balanceDue > 0) {
                const application = Math.min(remainingToApply, balanceDue);
                const newPaidTotal = paidAmount + application;

                await (tx as any).legacyInvoice.update({
                  where: { id: targetInv.id },
                  data: {
                    paid_amount: String(newPaidTotal),
                    status: newPaidTotal >= grandTotal ? 'PAID' : 'BILLED'
                  }
                });
                remainingToApply -= application;
              }
            }
          }

          // B. FIFO: Older Invoices
          if (remainingToApply > 0) {
            const pendingInvoices = await (tx as any).legacyInvoice.findMany({
              where: {
                customer_id: parseInt(String(partyId)),
                status: { not: 'PAID' },
                company_id: finalCompanyId,
                id: linkedInvoiceId ? { not: parseInt(String(linkedInvoiceId)) } : undefined
              },
              orderBy: { invoice_date: 'asc' }
            });

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
        } else if (linkedInvoiceId) {
          // If not handled as a Customer Invoice, handle as an Inward (for both Customer/Vendor)
          try {
            await (tx as any).inwardEntry.update({
              where: { id: String(linkedInvoiceId) },
              data: { status: 'completed' }
            });
          } catch (e) {
            console.log("[LEDGER] Skip inward reconciliation - not found or already handled");
          }
        }
      }

      return newEntry;
    });

    res.status(201).json(entry);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to add ledger entry', detail: error.message });
  }
};
