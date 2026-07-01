import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import { logAudit } from '../../utils/auditLogger';
import { withRetry } from '../../utils/retry';
import crypto from 'crypto';
import { generateNextSequence } from '../../utils/sequenceGenerator';

export const getAllVouchers = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  // Pagination & Filter Params
  const page = parseInt(req.query.page as string) || 1;
  const limit = req.query.id ? 100 : (parseInt(req.query.limit as string) || 10);
  const skip = (page - 1) * limit;
  const search = (req.query.search as string || '').toLowerCase();
  const id = req.query.id as string;

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

    if (id) {
      where.AND.push({ id: String(id) });
    }

    if (req.query.inward_id) {
      where.AND.push({ inward_id: String(req.query.inward_id) });
    }

    if (search) {
      where.AND.push({
        OR: [
          { voucher_no: { contains: search.toLowerCase() } },
          { voucher_no: { contains: search.toUpperCase() } },
          { party_name: { contains: search.toLowerCase() } },
          { party_name: { contains: search.toUpperCase() } },
          { reference_no: { contains: search.toLowerCase() } },
          { reference_no: { contains: search.toUpperCase() } },
          { description_: { contains: search.toLowerCase() } },
          { description_: { contains: search.toUpperCase() } }
        ]
      });
    }

    const fromDate = req.query.fromDate as string;
    const toDate   = req.query.toDate as string;
    const partyId  = req.query.partyId as string;

    if (fromDate || toDate) {
      const dateFilter: any = {};
      if (fromDate) dateFilter.gte = new Date(fromDate);
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        dateFilter.lte = endOfDay;
      }
      where.AND.push({ date: dateFilter });
    }


    if (partyId) {
      where.AND.push({ party_id: String(partyId) });
    }

    const partyType = req.query.partyType as string;
    if (partyType && partyType !== 'all') {
      if (partyType === 'customer') {
        where.AND.push({
          OR: [
            { party_type: 'customer' },
            { party_type: null },
            { party_type: '' }
          ]
        });
      } else {
        where.AND.push({ party_type: partyType });
      }
    }

    const [vouchers, totalCount, aggregateData] = await withRetry(() => Promise.all([
      prisma.voucher.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' }
      }),
      prisma.voucher.count({ where }),
      prisma.voucher.aggregate({
        where,
        _sum: {
          amount: true,
          tds_amount: true,
          others_amount: true
        }
      })
    ]));

    const totalCollected = aggregateData._sum.amount || 0;
    const totalTDS = aggregateData._sum.tds_amount || 0;
    const totalOthers = aggregateData._sum.others_amount || 0;

    res.json({
      items: vouchers.map((v: any) => {
        let items = [];
        try {
          items = JSON.parse(v.items_json || '[]');
        } catch (e) {
          console.error(`Malformed JSON in voucher ${v.id}`);
        }
        return { ...v, items };
      }),
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      },
      aggregates: { totalCollected, totalTDS, totalOthers }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch vouchers', detail: error.message });
  }
};

export const createVoucher = async (req: AuthRequest, res: Response) => {
  const { id, voucher_no, date, type, party_id, party_name, party_type, amount, payment_mode, reference_no, cheque_no, description, company_id, companyId, status, tds_amount, tdsAmount, others_amount, othersAmount, inward_id, inward_no, items } = req.body;
  const user = req.user;
  const rawCompanyId = company_id || companyId || user?.company_id || (user as any)?.companyId;
  const finalCompanyId = rawCompanyId ? String(rawCompanyId).toLowerCase() : null;

  try {
    const finalAmount = parseFloat(String(amount || '0'));
    const finalId = (id && id.trim() !== '') ? id : crypto.randomUUID();
    const finalVoucherNo = voucher_no || await generateNextSequence('app_vouchers', 'voucher_no', 'VCH-');

    const result = await withRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        // 1. Create the Voucher
        const voucher = await (tx.voucher as any).create({
          data: {
            id: finalId,
            voucher_no: finalVoucherNo,
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
            status: status || 'posted',
            tds_amount: parseFloat(String(tds_amount ?? tdsAmount ?? '0')) || 0,
            others_amount: parseFloat(String(others_amount ?? othersAmount ?? '0')) || 0,
            inward_id,
            inward_no,
            items_json: JSON.stringify(items || [])
          }
        });

        // 2. If it's a receipt from a customer or a payment to a vendor, update the Invoice and Ledger
        if ((type === 'receipt' && party_type === 'customer') || (type === 'payment' && party_type === 'vendor')) {
          const invNumbers = reference_no 
            ? String(reference_no)
                .split(',')
                .map((s: string) => s.trim().split('(')[0].trim()) 
                .filter(Boolean) 
            : [];
          
          if (invNumbers.length > 0) {
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

            const totalSettlementAmount = finalAmount + (parseFloat(String(tds_amount ?? tdsAmount ?? '0')) || 0) + (parseFloat(String(others_amount ?? othersAmount ?? '0')) || 0);
            let remainingAmount = totalSettlementAmount;
            for (const inv of invoices) {
              if (remainingAmount <= 0) break;
              
              const cleanGrand = String(inv.grand_total || '0').replace(/[^\d.]/g, '');
              const cleanPaid  = String(inv.paid_amount  || '0').replace(/[^\d.]/g, '');
              
              const currentGrandTotal = parseFloat(cleanGrand) || 0;
              const currentPaidAmount = parseFloat(cleanPaid) || 0;
              
              const balanceDue = currentGrandTotal - currentPaidAmount;
              if (balanceDue <= 0.1) continue; 

              const paymentForThisInvoice = Math.min(remainingAmount, balanceDue);
              const newPaidAmount = currentPaidAmount + paymentForThisInvoice;
              
              await (tx as any).legacyInvoice.update({
                where: { id: inv.id },
                data: {
                  paid_amount: String(newPaidAmount),
                  status: newPaidAmount >= (currentGrandTotal - 0.5) ? 'PAID' : 'BILLED'
                }
              });
              remainingAmount -= paymentForThisInvoice;
            }
          }
        }

        // 3. UPDATE LEDGER
        if (party_id) {
          await (tx.ledgerEntry as any).deleteMany({ where: { reference_id: voucher.voucher_no || voucher.id } });

          const lastEntry = await (tx.ledgerEntry as any).findFirst({
             where: {
               party_id: String(party_id),
               company_id: finalCompanyId ? String(finalCompanyId) : undefined
             },
             orderBy: { created_at: 'desc' }
          });

          const lastBalance = lastEntry ? (lastEntry.balance || 0) : 0;
          const currentTDS = parseFloat(String(tds_amount ?? tdsAmount ?? '0')) || 0;
          const currentOthers = parseFloat(String(others_amount ?? othersAmount ?? '0')) || 0;
          // totalSettlementAmount = net paid (cash/bank) + adjustments (TDS + Others)
          // This represents the gross invoice amount being settled
          const totalSettlementAmount = finalAmount + currentTDS + currentOthers;
          // Ledger entry stores the NET amount actually paid (finalAmount)
          // The adjustment (TDS + Others) reduces what the party owes but is NOT a cash receipt/payment
          const ledgerAmount = finalAmount;

          let entryType = type === 'receipt' ? 'credit' : 'debit';
          let change = ledgerAmount;
          let newBalance = lastBalance;

          if (party_type === 'customer') {
            newBalance = type === 'receipt' ? (lastBalance - change) : (lastBalance + change);
          } else if (party_type === 'vendor') {
            entryType = type === 'payment' ? 'debit' : 'credit';
            newBalance = type === 'payment' ? (lastBalance - change) : (lastBalance + change);
          }

          await (tx.ledgerEntry as any).create({
            data: {
              id: crypto.randomUUID(),
              party_id: String(party_id),
              party_name: party_name || 'N/A',
              party_type: party_type || 'customer',
              company_id: finalCompanyId ? String(finalCompanyId) : null,
              date: date ? new Date(date) : new Date(),
              vch_type: type.toUpperCase(),
              vch_no: voucher.voucher_no || voucher.id,
              type: entryType,
              amount: ledgerAmount,
              balance: newBalance,
              description: (() => {
                const modeLabel = payment_mode ? ` | ${String(payment_mode).toUpperCase()}` : '';
                const tdsLabel = currentTDS > 0 ? ` (TDS: ₹${currentTDS})` : '';
                const othersLabel = currentOthers > 0 ? ` (Others: ₹${currentOthers})` : '';
                return `${type.toUpperCase()} - ${voucher.voucher_no || voucher.id}${modeLabel}${tdsLabel}${othersLabel}`;
              })(),
              reference_id: String(voucher.id)
            }
          });
        }
        return voucher;
      }, {
        maxWait: 15000,
        timeout: 45000
      });
    }, 3, 2000);

    res.status(201).json(result);
  } catch (error: any) {
    console.error('❌ VOUCHER CREATE ERROR:', error);
    res.status(500).json({ error: 'Failed to create voucher', detail: error.message });
  }
};

export const updateVoucher = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { voucher_no, date, type, party_id, party_name, party_type, amount, payment_mode, reference_no, cheque_no, description, status, tds_amount, tdsAmount, others_amount, othersAmount, inward_id, inward_no, items } = req.body;

  try {
    const result = await withRetry(async () => {
      return await prisma.$transaction(async (tx) => {
        const oldVoucher = await tx.voucher.findUnique({ where: { id: String(id) } });
        if (!oldVoucher) throw new Error('Voucher not found');

        const oldAmount = parseFloat(String(oldVoucher.amount || '0'));
        const newAmount = parseFloat(String(amount || '0'));
        const deltaAmount = newAmount - oldAmount;

        const updatedVoucher = await (tx.voucher as any).update({
          where: { id: String(id) },
          data: {
            voucher_no,
            date: date ? new Date(date) : undefined,
            type,
            party_id,
            party_name,
            party_type,
            amount: newAmount,
            payment_mode,
            reference_no,
            cheque_no,
            description_: description,
            status: status?.toLowerCase(),
            tds_amount: (tds_amount !== undefined || tdsAmount !== undefined) ? parseFloat(String(tds_amount ?? tdsAmount)) : undefined,
            others_amount: (others_amount !== undefined || othersAmount !== undefined) ? parseFloat(String(others_amount ?? othersAmount)) : undefined,
            inward_id,
            inward_no,
            items_json: items ? JSON.stringify(items) : undefined
          }
        });

        if (Math.abs(deltaAmount) > 0.01) {
          if (((type === 'receipt' && party_type === 'customer') || (type === 'payment' && party_type === 'vendor')) && deltaAmount > 0) {
            const invNumbers = reference_no 
              ? String(reference_no).split(',').map((s: string) => s.trim().split('(')[0].trim()).filter(Boolean) 
              : [];
            
            if (invNumbers.length > 0) {
              const invNumsAsInts = invNumbers.map((n: string) => {
                const onlyDigits = n.replace(/\D/g, '');
                return onlyDigits ? parseInt(onlyDigits, 10) : NaN;
              }).filter((n: number) => !isNaN(n));

              const invoices = await (tx as any).legacyInvoice.findMany({
                where: {
                  AND: [
                    { OR: [{ id: { in: invNumsAsInts } }, { invoice_no: { in: invNumsAsInts } }, { dc_no: { in: invNumbers } }] },
                    { OR: [{ company_id: updatedVoucher.company_id ? String(updatedVoucher.company_id) : undefined }, { company_id: updatedVoucher.company_id ? String(updatedVoucher.company_id).toLowerCase() : undefined }] }
                  ]
                }
              });

              const totalSettlementDelta = deltaAmount + (parseFloat(String(tds_amount ?? tdsAmount ?? '0')) || 0) + (parseFloat(String(others_amount ?? othersAmount ?? '0')) || 0);
              let remainingAmount = totalSettlementDelta;
              for (const inv of invoices) {
                if (remainingAmount <= 0) break;
                const cleanGrand = String(inv.grand_total || '0').replace(/[^\d.]/g, '');
                const cleanPaid  = String(inv.paid_amount  || '0').replace(/[^\d.]/g, '');
                const currentGrandTotal = parseFloat(cleanGrand) || 0;
                const currentPaidAmount = parseFloat(cleanPaid) || 0;
                const balanceDue = currentGrandTotal - currentPaidAmount;
                if (balanceDue <= 0.1) continue; 
                const paymentForThisInvoice = Math.min(remainingAmount, balanceDue);
                const newPaidAmount = currentPaidAmount + paymentForThisInvoice;
                await (tx as any).legacyInvoice.update({
                  where: { id: inv.id },
                  data: { paid_amount: String(newPaidAmount), status: newPaidAmount >= (currentGrandTotal - 0.5) ? 'PAID' : 'BILLED' }
                });
                remainingAmount -= paymentForThisInvoice;
              }
            }
          }
        }

        if (party_id) {
          await (tx.ledgerEntry as any).deleteMany({
            where: {
              OR: [
                { reference_id: String(oldVoucher.id) }, { reference_id: String(oldVoucher.voucher_no) }, { vch_no: String(oldVoucher.voucher_no) },
                { reference_id: String(updatedVoucher.id) }, { reference_id: String(updatedVoucher.voucher_no) }, { vch_no: String(updatedVoucher.voucher_no) }
              ]
            }
          });

          const lastEntry = await (tx.ledgerEntry as any).findFirst({
             where: { party_id: String(party_id), company_id: updatedVoucher.company_id ? String(updatedVoucher.company_id) : undefined },
             orderBy: { created_at: 'desc' }
          });

          const lastBalance = lastEntry ? (lastEntry.balance || 0) : 0;
          const currentTDS = parseFloat(String(tds_amount ?? tdsAmount ?? oldVoucher.tds_amount ?? '0')) || 0;
          const currentOthers = parseFloat(String(others_amount ?? othersAmount ?? oldVoucher.others_amount ?? '0')) || 0;
          const totalSettlementAmount = newAmount + currentTDS + currentOthers;
          // Ledger entry stores the NET amount actually paid (newAmount)
          // The adjustment (TDS + Others) reduces what the party owes but is NOT a cash receipt/payment
          const ledgerAmount = newAmount;

          let entryType = type === 'receipt' ? 'credit' : 'debit';
          let change = ledgerAmount;
          let newBalance = lastBalance;

          if (party_type === 'customer') {
            newBalance = type === 'receipt' ? (lastBalance - change) : (lastBalance + change);
          } else if (party_type === 'vendor') {
            entryType = type === 'payment' ? 'debit' : 'credit';
            newBalance = type === 'payment' ? (lastBalance - change) : (lastBalance + change);
          }

          await (tx.ledgerEntry as any).create({
            data: {
              id: crypto.randomUUID(),
              party_id: String(party_id),
              party_name: party_name || 'N/A',
              party_type: party_type || 'customer',
              company_id: updatedVoucher.company_id ? String(updatedVoucher.company_id) : null,
              date: date ? new Date(date) : new Date(),
              vch_type: type.toUpperCase(),
              vch_no: updatedVoucher.voucher_no || updatedVoucher.id,
              type: entryType,
              amount: ledgerAmount,
              balance: newBalance,
              description: (() => {
                const modeLabel = payment_mode ? ` | ${String(payment_mode).toUpperCase()}` : '';
                const tdsLabel = currentTDS > 0 ? ` (TDS: ₹${currentTDS})` : '';
                const othersLabel = currentOthers > 0 ? ` (Others: ₹${currentOthers})` : '';
                return `${type.toUpperCase()} - ${updatedVoucher.voucher_no || updatedVoucher.id}${modeLabel}${tdsLabel}${othersLabel}`;
              })(),
              reference_id: String(updatedVoucher.id)
            }
          });
        }
        return updatedVoucher;
      }, {
        maxWait: 15000,
        timeout: 45000
      });
    }, 3, 2000);

    res.json({ ...result, items: JSON.parse((result as any).items_json || '[]') });
  } catch (error: any) {
    console.error('❌ VOUCHER UPDATE ERROR:', error);
    res.status(500).json({ error: 'Failed to update voucher', detail: error.message });
  }
};

export const deleteVoucher = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const voucher = await prisma.voucher.findUnique({ where: { id: String(id) } });
    await prisma.$transaction(async (tx) => {
      if (voucher) {
        await (tx.ledgerEntry as any).deleteMany({
          where: { OR: [{ reference_id: String(voucher.id) }, { reference_id: String(voucher.voucher_no) }, { vch_no: String(voucher.voucher_no) }] }
        });
      }
      await tx.voucher.delete({ where: { id: String(id) } });
    });
    res.json({ message: 'Voucher and associated ledger entries deleted successfully' });
  } catch (error: any) {
    console.error('❌ VOUCHER DELETE ERROR:', error);
    res.status(500).json({ error: 'Failed to delete voucher', detail: error.message });
  }
};
