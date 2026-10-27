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
  const sortBy = req.query.sortBy as string;
  const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
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
    const partyId = (req.query.partyId || req.query.party_id || req.query.customerId || req.query.customer_id) as string;

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

    if (partyId && partyId !== 'all') {
      const orConditions: any[] = [
        { party_id: String(partyId) }
      ];

      const parsedId = parseInt(partyId, 10);
      if (!isNaN(parsedId)) {
        try {
          const cust = await prisma.legacyCustomer.findUnique({
            where: { id: parsedId },
            select: { customer_name: true }
          });
          if (cust?.customer_name) {
            orConditions.push({ party_name: cust.customer_name });
          }
        } catch (e) {}
      } else {
        try {
          const vendor = await prisma.vendor.findFirst({
            where: { id: partyId },
            select: { name: true }
          });
          if (vendor?.name) {
            orConditions.push({ party_name: vendor.name });
          }
        } catch (e) {}
      }

      where.AND.push({
        OR: orConditions
      });
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

    const status = req.query.status as string;
    if (status && status !== 'all') {
      where.AND.push({ status: status });
    }

    const type = req.query.type as string;
    if (type && type !== 'all') {
      where.AND.push({ type: type });
    }

    const [vouchers, totalCount, aggregateData] = await withRetry(() => Promise.all([
      prisma.voucher.findMany({
        where,
        skip,
        take: limit,
        orderBy: sortBy ? { [sortBy]: sortOrder } : [
          { date: 'desc' },
          { voucher_no: 'desc' }
        ]
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
    const finalVoucherNo = voucher_no || await generateNextSequence('app_vouchers', 'voucher_no', '', finalCompanyId, 3001);

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

            const exactIds = Array.isArray(items) 
              ? items.map((i: any) => parseInt(String(i.id).replace(/\D/g, ''), 10)).filter((n: number) => !isNaN(n))
              : [];

            let invoices: any[] = [];
            if (exactIds.length > 0) {
              invoices = await (tx as any).legacyInvoice.findMany({
                where: {
                  id: { in: exactIds }
                }
              });
            } else {
              invoices = await (tx as any).legacyInvoice.findMany({
                where: {
                  OR: [
                    { invoice_no: { in: invNumsAsInts } },
                    { dc_no: { in: invNumbers } }
                  ]
                }
              });
            }

            const totalSettlementAmount = finalAmount + (parseFloat(String(tds_amount ?? tdsAmount ?? '0')) || 0) + (parseFloat(String(others_amount ?? othersAmount ?? '0')) || 0);
            let remainingAmount = totalSettlementAmount;
            for (const inv of invoices) {
              if (remainingAmount <= 0) break;
              
              let currentGrandTotal = parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0;
              if (currentGrandTotal <= 0) {
                const sub = inv.sub_total ?? (parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '')) || 0);
                const tax = inv.tax_total ?? (parseFloat(String(inv.tax_total || '0').replace(/[^\d.]/g, '')) || 0);
                if (sub > 0) currentGrandTotal = sub + tax;
              }
              const currentPaidAmount = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
              
              const balanceDue = currentGrandTotal - currentPaidAmount;
              if (balanceDue <= 0.1 && currentGrandTotal > 0) {
                if (inv.status !== 'PAID') {
                  await (tx as any).legacyInvoice.update({
                    where: { id: inv.id },
                    data: { status: 'PAID' }
                  });
                }
                continue; 
              }

              const paymentForThisInvoice = Math.min(remainingAmount, balanceDue > 0 ? balanceDue : remainingAmount);
              const newPaidAmount = currentPaidAmount + paymentForThisInvoice;
              const isPaid = (currentGrandTotal > 0 && newPaidAmount >= (currentGrandTotal - 0.5)) || (currentGrandTotal <= 0 && newPaidAmount > 0);
              
              await (tx as any).legacyInvoice.update({
                where: { id: inv.id },
                data: {
                  paid_amount: String(newPaidAmount),
                  status: isPaid ? 'PAID' : 'BILLED'
                }
              });
              remainingAmount -= paymentForThisInvoice;
            }
          }
        }

        // 3. UPDATE LEDGER
        await syncLedgerForVoucher(tx, voucher, items);
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

const syncLedgerForVoucher = async (tx: any, voucher: any, items?: any[], oldVoucher?: any) => {
  const party_id = voucher.party_id;
  if (!party_id) return;

  const party_type = voucher.party_type || 'customer';
  const type = (voucher.type || 'receipt').toLowerCase();
  const payment_mode = voucher.payment_mode;
  const cheque_no = voucher.cheque_no;
  const reference_no = voucher.reference_no;
  const date = voucher.date ? new Date(voucher.date) : new Date();
  const company_id = voucher.company_id ? String(voucher.company_id) : null;

  // 1. Delete previous entries associated with this voucher
  const deleteConditions: any[] = [
    { reference_id: String(voucher.id) },
    { reference_id: String(voucher.voucher_no) },
    { vch_no: String(voucher.voucher_no) }
  ];
  if (oldVoucher) {
    if (oldVoucher.id) deleteConditions.push({ reference_id: String(oldVoucher.id) });
    if (oldVoucher.voucher_no) {
      deleteConditions.push({ reference_id: String(oldVoucher.voucher_no) });
      deleteConditions.push({ vch_no: String(oldVoucher.voucher_no) });
    }
  }
  await (tx.ledgerEntry as any).deleteMany({
    where: { OR: deleteConditions }
  });

  // 2. Query running balance for party
  const lastEntry = await (tx.ledgerEntry as any).findFirst({
    where: {
      party_id: String(party_id),
      company_id: company_id ? String(company_id) : undefined
    },
    orderBy: { created_at: 'desc' }
  });

  const lastBalance = lastEntry ? (lastEntry.balance || 0) : 0;
  let currentBalance = lastBalance;

  const baseEntryType = type === 'receipt' ? 'credit' : 'debit';
  const resolvedEntryType = (party_type === 'vendor' && type === 'payment') ? 'debit' :
                            (party_type === 'vendor' && type === 'receipt') ? 'credit' : baseEntryType;

  // 3. Create Entries (Itemized or Fallback)
  if (items && Array.isArray(items) && items.length > 0) {
    let totalItemAdjustments = 0;
    for (const item of items) {
      const itemAmount = parseFloat(String(item.amount || '0'));
      const itemAdjustment = parseFloat(String(item.adjustmentValue || item.adjustment_value || '0'));
      const netItemAmount = Math.max(0, itemAmount - itemAdjustment);
      totalItemAdjustments += itemAdjustment;

      // 3a. Cash / Bank receipt or payment entry
      if (netItemAmount > 0) {
        if (party_type === 'customer') {
          currentBalance = type === 'receipt' ? (currentBalance - netItemAmount) : (currentBalance + netItemAmount);
        } else if (party_type === 'vendor') {
          currentBalance = type === 'payment' ? (currentBalance - netItemAmount) : (currentBalance + netItemAmount);
        }

        const mode = payment_mode ? String(payment_mode).toUpperCase() : '';
        const ref = cheque_no ? ` (No. ${cheque_no})` : '';
        const invStr = item.invoiceNo ? ` - Inv: ${item.invoiceNo}` : '';

        await (tx.ledgerEntry as any).create({
          data: {
            id: crypto.randomUUID(),
            party_id: String(party_id),
            party_name: voucher.party_name || 'N/A',
            party_type,
            company_id,
            date,
            vch_type: type.toUpperCase(),
            vch_no: voucher.voucher_no || voucher.id,
            type: resolvedEntryType,
            amount: netItemAmount,
            balance: currentBalance,
            description: `${mode}${ref}${invStr}`.trim() || type.toUpperCase(),
            reference_id: String(voucher.id)
          }
        });
      }

      // 3b. Separate JOURNAL entry for item's TDS or other adjustments
      if (itemAdjustment > 0) {
        if (party_type === 'customer') {
          currentBalance = type === 'receipt' ? (currentBalance - itemAdjustment) : (currentBalance + itemAdjustment);
        } else if (party_type === 'vendor') {
          currentBalance = type === 'payment' ? (currentBalance - itemAdjustment) : (currentBalance + itemAdjustment);
        }

        const adjType = item.adjustmentType || item.adjustment_type || 'TDS';
        const invStr = item.invoiceNo ? ` - Inv: ${item.invoiceNo}` : '';

        await (tx.ledgerEntry as any).create({
          data: {
            id: crypto.randomUUID(),
            party_id: String(party_id),
            party_name: voucher.party_name || 'N/A',
            party_type,
            company_id,
            date,
            vch_type: 'JOURNAL',
            vch_no: voucher.voucher_no || voucher.id,
            type: resolvedEntryType,
            amount: itemAdjustment,
            balance: currentBalance,
            description: `${adjType}${invStr}`,
            reference_id: String(voucher.id)
          }
        });
      }
    }

    // 3c. Check if there is remaining unallocated voucher-level TDS
    const totalVoucherTDS = parseFloat(String(voucher.tds_amount ?? '0')) || 0;
    const remainingTDS = totalVoucherTDS - totalItemAdjustments;
    if (remainingTDS > 0.5) {
      if (party_type === 'customer') {
        currentBalance = type === 'receipt' ? (currentBalance - remainingTDS) : (currentBalance + remainingTDS);
      } else if (party_type === 'vendor') {
        currentBalance = type === 'payment' ? (currentBalance - remainingTDS) : (currentBalance + remainingTDS);
      }

      await (tx.ledgerEntry as any).create({
        data: {
          id: crypto.randomUUID(),
          party_id: String(party_id),
          party_name: voucher.party_name || 'N/A',
          party_type,
          company_id,
          date,
          vch_type: 'JOURNAL',
          vch_no: voucher.voucher_no || voucher.id,
          type: resolvedEntryType,
          amount: remainingTDS,
          balance: currentBalance,
          description: 'TDS Deducted',
          reference_id: String(voucher.id)
        }
      });
    }
  } else {
    // 3d. Fallback for vouchers without item breakdown
    const ledgerAmount = parseFloat(String(voucher.amount || '0'));
    if (party_type === 'customer') {
      currentBalance = type === 'receipt' ? (currentBalance - ledgerAmount) : (currentBalance + ledgerAmount);
    } else if (party_type === 'vendor') {
      currentBalance = type === 'payment' ? (currentBalance - ledgerAmount) : (currentBalance + ledgerAmount);
    }

    const currentTDS = parseFloat(String(voucher.tds_amount || '0')) || 0;
    const currentOthers = parseFloat(String(voucher.others_amount || '0')) || 0;

    await (tx.ledgerEntry as any).create({
      data: {
        id: crypto.randomUUID(),
        party_id: String(party_id),
        party_name: voucher.party_name || 'N/A',
        party_type,
        company_id,
        date,
        vch_type: type.toUpperCase(),
        vch_no: voucher.voucher_no || voucher.id,
        type: resolvedEntryType,
        amount: ledgerAmount,
        balance: currentBalance,
        description: (() => {
          const mode = payment_mode ? String(payment_mode).toUpperCase() : '';
          const ref = (cheque_no || reference_no) ? ` (No. ${cheque_no || reference_no})` : '';
          return `${mode}${ref}`.trim() || type.toUpperCase();
        })(),
        reference_id: String(voucher.id)
      }
    });

    if (currentTDS > 0) {
      if (party_type === 'customer') {
        currentBalance = type === 'receipt' ? (currentBalance - currentTDS) : (currentBalance + currentTDS);
      } else if (party_type === 'vendor') {
        currentBalance = type === 'payment' ? (currentBalance - currentTDS) : (currentBalance + currentTDS);
      }

      await (tx.ledgerEntry as any).create({
        data: {
          id: crypto.randomUUID(),
          party_id: String(party_id),
          party_name: voucher.party_name || 'N/A',
          party_type,
          company_id,
          date,
          vch_type: 'JOURNAL',
          vch_no: voucher.voucher_no || voucher.id,
          type: resolvedEntryType,
          amount: currentTDS,
          balance: currentBalance,
          description: `TDS Deducted${reference_no ? ` - ${reference_no}` : ''}`,
          reference_id: String(voucher.id)
        }
      });
    }

    if (currentOthers > 0) {
      if (party_type === 'customer') {
        currentBalance = type === 'receipt' ? (currentBalance - currentOthers) : (currentBalance + currentOthers);
      } else if (party_type === 'vendor') {
        currentBalance = type === 'payment' ? (currentBalance - currentOthers) : (currentBalance + currentOthers);
      }

      await (tx.ledgerEntry as any).create({
        data: {
          id: crypto.randomUUID(),
          party_id: String(party_id),
          party_name: voucher.party_name || 'N/A',
          party_type,
          company_id,
          date,
          vch_type: 'JOURNAL',
          vch_no: voucher.voucher_no || voucher.id,
          type: resolvedEntryType,
          amount: currentOthers,
          balance: currentBalance,
          description: `Adjustment Deducted${reference_no ? ` - ${reference_no}` : ''}`,
          reference_id: String(voucher.id)
        }
      });
    }
  }
};

const revertInvoicesForVoucher = async (tx: any, voucher: any) => {
  if (!voucher) return;
  if ((voucher.type === 'receipt' && voucher.party_type === 'customer') || (voucher.type === 'payment' && voucher.party_type === 'vendor')) {
    const invNumbers = voucher.reference_no 
      ? String(voucher.reference_no).split(',').map((s: string) => s.trim().split('(')[0].trim()).filter(Boolean) 
      : [];
    
    if (invNumbers.length > 0) {
      const invNumsAsInts = invNumbers.map((n: string) => {
        const onlyDigits = n.replace(/\D/g, '');
        return onlyDigits ? parseInt(onlyDigits, 10) : NaN;
      }).filter((n: number) => !isNaN(n));

      let oldItems: any[] = [];
      try { oldItems = JSON.parse(voucher.items_json || '[]'); } catch (e) {}

      const exactIds = Array.isArray(oldItems) 
        ? oldItems.map((i: any) => parseInt(String(i.id).replace(/\D/g, ''), 10)).filter((n: number) => !isNaN(n))
        : [];

      let invoices: any[] = [];
      if (exactIds.length > 0) {
        invoices = await (tx as any).legacyInvoice.findMany({
          where: {
            id: { in: exactIds }
          }
        });
      } else {
        invoices = await (tx as any).legacyInvoice.findMany({
          where: {
            OR: [
              { invoice_no: { in: invNumsAsInts } },
              { dc_no: { in: invNumbers } }
            ]
          }
        });
      }

      const voucherAmount = parseFloat(String(voucher.amount || '0'));
      const oldTds = parseFloat(String(voucher.tds_amount || '0')) || 0;
      const oldOthers = parseFloat(String(voucher.others_amount || '0')) || 0;
      const totalRevertAmount = voucherAmount + oldTds + oldOthers;
      let remainingRevertAmount = totalRevertAmount;
      
      for (const inv of invoices) {
        if (remainingRevertAmount <= 0) break;
        const cleanGrand = String(inv.grand_total || '0').replace(/[^\d.]/g, '');
        const cleanPaid  = String(inv.paid_amount  || '0').replace(/[^\d.]/g, '');
        let currentGrandTotal = parseFloat(cleanGrand) || 0;
        if (currentGrandTotal <= 0) {
          const sub = inv.sub_total ?? (parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '')) || 0);
          const tax = inv.tax_total ?? (parseFloat(String(inv.tax_total || '0').replace(/[^\d.]/g, '')) || 0);
          if (sub > 0) currentGrandTotal = sub + tax;
        }
        const currentPaidAmount = parseFloat(cleanPaid) || 0;
        
        const revertForThisInvoice = Math.min(remainingRevertAmount, currentPaidAmount);
        if (revertForThisInvoice <= 0) continue; 
        
        const newPaidAmount = currentPaidAmount - revertForThisInvoice;
        const isPaid = (currentGrandTotal > 0 && newPaidAmount >= (currentGrandTotal - 0.5));
        await (tx as any).legacyInvoice.update({
          where: { id: inv.id },
          data: { paid_amount: String(Math.max(0, newPaidAmount)), status: isPaid ? 'PAID' : 'BILLED' }
        });
        remainingRevertAmount -= revertForThisInvoice;
      }
    }
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

        await revertInvoicesForVoucher(tx, oldVoucher);

        if ((type === 'receipt' && party_type === 'customer') || (type === 'payment' && party_type === 'vendor')) {
          const invNumbers = reference_no 
            ? String(reference_no).split(',').map((s: string) => s.trim().split('(')[0].trim()).filter(Boolean) 
            : [];
          
          if (invNumbers.length > 0) {
            const invNumsAsInts = invNumbers.map((n: string) => {
              const onlyDigits = n.replace(/\D/g, '');
              return onlyDigits ? parseInt(onlyDigits, 10) : NaN;
            }).filter((n: number) => !isNaN(n));

            const exactIds = Array.isArray(items) 
              ? items.map((i: any) => parseInt(String(i.id).replace(/\D/g, ''), 10)).filter((n: number) => !isNaN(n))
              : [];

            let invoices: any[] = [];
            if (exactIds.length > 0) {
              invoices = await (tx as any).legacyInvoice.findMany({
                where: {
                  id: { in: exactIds }
                }
              });
            } else {
              invoices = await (tx as any).legacyInvoice.findMany({
                where: {
                  OR: [
                    { invoice_no: { in: invNumsAsInts } },
                    { dc_no: { in: invNumbers } }
                  ]
                }
              });
            }

            const totalSettlementAmount = newAmount + (parseFloat(String(tds_amount ?? tdsAmount ?? '0')) || 0) + (parseFloat(String(others_amount ?? othersAmount ?? '0')) || 0);
            let remainingAmount = totalSettlementAmount;
            for (const inv of invoices) {
              if (remainingAmount <= 0) break;
              let currentGrandTotal = parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0;
              if (currentGrandTotal <= 0) {
                const sub = inv.sub_total ?? (parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '')) || 0);
                const tax = inv.tax_total ?? (parseFloat(String(inv.tax_total || '0').replace(/[^\d.]/g, '')) || 0);
                if (sub > 0) currentGrandTotal = sub + tax;
              }
              const currentPaidAmount = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
              const balanceDue = currentGrandTotal - currentPaidAmount;
              if (balanceDue <= 0.1 && currentGrandTotal > 0) {
                if (inv.status !== 'PAID') {
                  await (tx as any).legacyInvoice.update({
                    where: { id: inv.id },
                    data: { status: 'PAID' }
                  });
                }
                continue; 
              }
              const paymentForThisInvoice = Math.min(remainingAmount, balanceDue > 0 ? balanceDue : remainingAmount);
              const newPaidAmount = currentPaidAmount + paymentForThisInvoice;
              const isPaid = (currentGrandTotal > 0 && newPaidAmount >= (currentGrandTotal - 0.5)) || (currentGrandTotal <= 0 && newPaidAmount > 0);
              await (tx as any).legacyInvoice.update({
                where: { id: inv.id },
                data: { paid_amount: String(newPaidAmount), status: isPaid ? 'PAID' : 'BILLED' }
              });
              remainingAmount -= paymentForThisInvoice;
            }
          }
        }

        // 3. UPDATE LEDGER
        await syncLedgerForVoucher(tx, updatedVoucher, items, oldVoucher);
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
        await revertInvoicesForVoucher(tx, voucher);
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
