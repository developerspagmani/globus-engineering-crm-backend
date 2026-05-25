import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getLedgerEntries = async (req: AuthRequest, res: Response) => {
  const { partyId, companyId: queryCompanyId, dateFrom, dateTo } = req.query;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  // Pagination Params
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
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
          { company_id: String(companyId).toLowerCase() }
        ]
      });
    }

    if (partyId) {
      where.AND.push({ party_id: String(partyId) });
    }

    const partyType = req.query.partyType as string;
    if (partyType && partyType !== 'all') {
      where.AND.push({ party_type: String(partyType) });
    }

    // 1. Calculate Opening Balance if dateFrom is provided
    let openingBalance = 0;
    if (dateFrom && partyId) {
      const entriesBefore = await (prisma.ledgerEntry as any).findMany({
        where: {
          AND: [
            { party_id: String(partyId) },
            companyId ? {
              OR: [
                { company_id: String(companyId) },
                { company_id: String(companyId).toLowerCase() }
              ]
            } : {},
            { date: { lt: new Date(dateFrom as string) } },
            { vch_type: { notIn: ['INVOICE', 'OUTWARD'] } }
          ]
        }
      });

      // Simple sum - logic should match the frontend's isVendor check
      // However, the backend doesn't always know if it's a vendor or customer here easily without a separate query.
      // We'll rely on the frontend to interpret the opening balance based on the party type it knows.
      // Or we can just return the raw credit/debit sums.
      
      let totalDr = 0;
      let totalCr = 0;
      entriesBefore.forEach((e: any) => {
        if (e.type === 'debit') totalDr += parseFloat(String(e.amount || 0));
        else totalCr += parseFloat(String(e.amount || 0));
      });
      openingBalance = totalDr - totalCr; // Standard: Debit - Credit
    }

    const entriesWhere: any = { 
      AND: [
        ...where.AND,
        { vch_type: { notIn: ['INVOICE', 'OUTWARD'] } } // Only include voucher-based entries
      ] 
    };
    if (dateFrom) entriesWhere.AND.push({ date: { gte: new Date(dateFrom as string) } });
    if (dateTo) entriesWhere.AND.push({ date: { lte: new Date(dateTo as string) } });
    if (search) {
      entriesWhere.AND.push({
        OR: [
          { vch_no: { contains: search.toLowerCase() } },
          { vch_no: { contains: search.toUpperCase() } },
          { description: { contains: search.toLowerCase() } },
          { description: { contains: search.toUpperCase() } },
          { vch_type: { contains: search.toLowerCase() } },
          { vch_type: { contains: search.toUpperCase() } }
        ]
      });
    }

    const [entries, totalCount] = await Promise.all([
      (prisma.ledgerEntry as any).findMany({
        where: entriesWhere,
        skip,
        take: limit,
        orderBy: [
          { date: 'desc' },
          { created_at: 'desc' }
        ]
      }),
      (prisma.ledgerEntry as any).count({ where: entriesWhere })
    ]);

    res.json({
      items: entries,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      },
      openingBalance // Raw Debit - Credit sum
    });
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
