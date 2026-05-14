import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

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
      if (toDate)   dateFilter.lte = new Date(toDate);
      where.AND.push({ date: dateFilter });
    }


    if (partyId) {
      where.AND.push({ party_id: String(partyId) });
    }

    const [vouchers, totalCount, amountRows] = await Promise.all([
      prisma.voucher.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' }
      }),
      prisma.voucher.count({ where }),
      prisma.voucher.findMany({ where, select: { amount: true, tds_amount: true } })
    ]);

    const totalCollected = amountRows.reduce(
      (sum: number, v: any) => sum + (parseFloat(String(v.amount || '0').replace(/[^\d.]/g, '')) || 0),
      0
    );

    const totalTDS = amountRows.reduce((sum: number, v: any) => sum + (Number(v.tds_amount) || 0), 0);

    res.json({
      items: vouchers.map((v: any) => ({ ...v, items: JSON.parse(v.items_json || '[]') })),
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      },
      aggregates: { totalCollected, totalTDS }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch vouchers', detail: error.message });
  }
};

export const createVoucher = async (req: AuthRequest, res: Response) => {
  const { id, voucher_no, date, type, party_id, party_name, party_type, amount, payment_mode, reference_no, cheque_no, description, company_id, companyId, status, tds_amount, inward_id, inward_no, items } = req.body;
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
          status: status || 'posted',
          tds_amount: parseFloat(String(tds_amount || '0')) || 0,
          inward_id,
          inward_no,
          items_json: JSON.stringify(items || [])
        }
      });

      // 2. If it's a receipt from a customer or a payment to a vendor, update the Invoice and Ledger
      if ((type === 'receipt' && party_type === 'customer') || (type === 'payment' && party_type === 'vendor')) {
        // Extract invoice numbers/IDs from the reference string (handles "INV-001 (5000)" format)
        const invNumbers = reference_no 
          ? String(reference_no)
              .split(',')
              .map((s: string) => s.trim().split('(')[0].trim()) 
              .filter(Boolean) 
          : [];
        
        if (invNumbers.length > 0) {
          // Map to integers for DB lookup (handles both IDs and Invoice Nos)
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
            
            // Clean strings of currency symbols and commas before parsing
            const cleanGrand = String(inv.grand_total || '0').replace(/[^\d.]/g, '');
            const cleanPaid  = String(inv.paid_amount  || '0').replace(/[^\d.]/g, '');
            
            const currentGrandTotal = parseFloat(cleanGrand) || 0;
            const currentPaidAmount = parseFloat(cleanPaid) || 0;
            
            const balanceDue = currentGrandTotal - currentPaidAmount;
            if (balanceDue <= 0.1) continue; // Already paid

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

      // 3. UPDATE LEDGER (For both Customers and Vendors)
      if (party_id) {
        // Delete any existing ledger entries for this voucher reference first
        await (tx.ledgerEntry as any).deleteMany({
          where: {
            reference_id: voucher.voucher_no || voucher.id
          }
        });

        const lastEntry = await (tx.ledgerEntry as any).findFirst({
           where: {
             party_id: String(party_id),
             company_id: finalCompanyId ? String(finalCompanyId) : undefined
           },
           orderBy: { created_at: 'desc' }
        });

        const lastBalance = lastEntry ? (lastEntry.balance || 0) : 0;
        
        let entryType = type === 'receipt' ? 'credit' : 'debit';
        let change = finalAmount;
        let newBalance = lastBalance;

        if (party_type === 'customer') {
          newBalance = type === 'receipt' ? (lastBalance - change) : (lastBalance + change);
        } else if (party_type === 'vendor') {
          // Vendor payment (OUT) is debit (reduces balance), receipt (IN) is credit (increases balance)
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
            vch_type: type.toUpperCase(), // RECEIPT or PAYMENT
            vch_no: voucher.voucher_no || voucher.id,
            type: entryType,
            amount: finalAmount,
            balance: newBalance,
            description: `${type.charAt(0).toUpperCase() + type.slice(1)}: ${payment_mode.toUpperCase()} ${cheque_no ? `(CHQ: ${cheque_no})` : ''} ${reference_no ? `Ref: ${reference_no}` : ''}`,
            reference_id: voucher.voucher_no || voucher.id
          }
        });

        // Double-entry customer posting for Job Work Vendors
        const selectedInwardId = inward_id || voucher.inward_id;
        if (party_type === 'vendor' && selectedInwardId) {
          const inwardEntry = await (tx as any).inwardEntry.findUnique({
            where: { id: String(selectedInwardId) }
          });
          if (inwardEntry) {
            let targetCustomerId = inwardEntry.customer_id;
            let targetCustomerName = inwardEntry.customer_name;

            // Trace to customer if customer_id is missing or empty on a vendor inward
            if ((!targetCustomerId || targetCustomerId.trim() === '') && inwardEntry.outward_id) {
              const outwardEntry = await (tx as any).outwardEntry.findUnique({
                where: { id: String(inwardEntry.outward_id) }
              });
              if (outwardEntry) {
                if (outwardEntry.customer_id && outwardEntry.customer_id.trim() !== '') {
                  targetCustomerId = outwardEntry.customer_id;
                  targetCustomerName = outwardEntry.customer_name;
                } else if (outwardEntry.inward_id) {
                  const originalInward = await (tx as any).inwardEntry.findUnique({
                    where: { id: String(outwardEntry.inward_id) }
                  });
                  if (originalInward) {
                    targetCustomerId = originalInward.customer_id;
                    targetCustomerName = originalInward.customer_name;
                  }
                }
              }
            }

            if (targetCustomerId && targetCustomerId.trim() !== '') {
              const custLastEntry = await (tx.ledgerEntry as any).findFirst({
                where: {
                  party_id: String(targetCustomerId),
                  company_id: finalCompanyId ? String(finalCompanyId) : undefined
                },
                orderBy: { created_at: 'desc' }
              });
              const custLastBalance = custLastEntry ? (custLastEntry.balance || 0) : 0;
              // For Customer: a Debit increases their balance (since Customer owes us)
              const custNewBalance = custLastBalance + finalAmount;

              await (tx.ledgerEntry as any).create({
                data: {
                  id: crypto.randomUUID(),
                  party_id: String(targetCustomerId),
                  party_name: targetCustomerName || 'Customer',
                  party_type: 'customer',
                  company_id: finalCompanyId ? String(finalCompanyId) : null,
                  date: date ? new Date(date) : new Date(),
                  vch_type: 'JOURNAL',
                  vch_no: voucher.voucher_no || voucher.id,
                  type: 'debit',
                  amount: finalAmount,
                  balance: custNewBalance,
                  description: `Processing Charge (Job Work Vendor: ${party_name || 'Vendor'}) for Inward: ${inwardEntry.inward_no || 'N/A'}`,
                  reference_id: voucher.voucher_no || voucher.id
                }
              });
            }
          }
        }
      }

      return voucher;
    }, {
      maxWait: 10000,
      timeout: 30000
    });

    res.status(201).json(result);
  } catch (error: any) {
    console.error('❌ PRISMA VOUCHER CREATE ERROR:', error);
    res.status(500).json({ 
      error: 'Failed to create voucher', 
      message: error.message,
      detail: error.code || 'UNKNOWN_ERROR'
    });
  }
};

export const updateVoucher = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { voucher_no, date, type, party_id, party_name, party_type, amount, payment_mode, reference_no, cheque_no, description, status, tds_amount, inward_id, inward_no, items } = req.body;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Get the existing voucher to calculate the delta
      const oldVoucher = await tx.voucher.findUnique({
        where: { id: String(id) }
      });

      if (!oldVoucher) {
        throw new Error('Voucher not found');
      }

      const oldAmount = parseFloat(String(oldVoucher.amount || '0'));
      const newAmount = parseFloat(String(amount || '0'));
      const deltaAmount = newAmount - oldAmount;

      // 2. Update the Voucher
      const updatedVoucher = await tx.voucher.update({
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
          tds_amount: tds_amount ? parseFloat(String(tds_amount)) : undefined,
          inward_id,
          inward_no,
          items_json: items ? JSON.stringify(items) : undefined
        }
      });

      // 3. If there's a significant delta, update Invoices and Ledger
      if (Math.abs(deltaAmount) > 0.01) {
        
        // Update Invoice balances (For Customer Receipts and Vendor Payments)
        if (((type === 'receipt' && party_type === 'customer') || (type === 'payment' && party_type === 'vendor')) && deltaAmount > 0) {
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
                      { company_id: updatedVoucher.company_id ? String(updatedVoucher.company_id) : undefined },
                      { company_id: updatedVoucher.company_id ? String(updatedVoucher.company_id).toLowerCase() : undefined }
                    ]
                  }
                ]
              }
            });

            let remainingAmount = deltaAmount;
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
      }

      // 4. UPDATE LEDGER (For any party_id)
      if (party_id) {
        // Delete any existing ledger entries for this voucher reference first
        await (tx.ledgerEntry as any).deleteMany({
          where: {
            reference_id: updatedVoucher.voucher_no || updatedVoucher.id
          }
        });

        const lastEntry = await (tx.ledgerEntry as any).findFirst({
           where: {
             party_id: String(party_id),
             company_id: updatedVoucher.company_id ? String(updatedVoucher.company_id) : undefined
           },
           orderBy: { created_at: 'desc' }
        });

        const lastBalance = lastEntry ? (lastEntry.balance || 0) : 0;
        
        let entryType = type === 'receipt' ? 'credit' : 'debit';
        let change = newAmount;
        let newBalance = lastBalance;

        if (party_type === 'customer') {
          newBalance = type === 'receipt' ? (lastBalance - change) : (lastBalance + change);
        } else if (party_type === 'vendor') {
          // Vendor payment (OUT) is debit (reduces balance), receipt (IN) is credit (increases balance)
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
            amount: newAmount,
            balance: newBalance,
            description: `${type.charAt(0).toUpperCase() + type.slice(1)}: ${payment_mode.toUpperCase()} ${cheque_no ? `(CHQ: ${cheque_no})` : ''} ${reference_no ? `Ref: ${reference_no}` : ''}`,
            reference_id: updatedVoucher.voucher_no || updatedVoucher.id
          }
        });

        // Double-entry customer posting for Job Work Vendors
        const selectedInwardId = inward_id || updatedVoucher.inward_id;
        if (party_type === 'vendor' && selectedInwardId) {
          const inwardEntry = await (tx as any).inwardEntry.findUnique({
            where: { id: String(selectedInwardId) }
          });
          if (inwardEntry) {
            let targetCustomerId = inwardEntry.customer_id;
            let targetCustomerName = inwardEntry.customer_name;

            // Trace to customer if customer_id is missing or empty on a vendor inward
            if ((!targetCustomerId || targetCustomerId.trim() === '') && inwardEntry.outward_id) {
              const outwardEntry = await (tx as any).outwardEntry.findUnique({
                where: { id: String(inwardEntry.outward_id) }
              });
              if (outwardEntry) {
                if (outwardEntry.customer_id && outwardEntry.customer_id.trim() !== '') {
                  targetCustomerId = outwardEntry.customer_id;
                  targetCustomerName = outwardEntry.customer_name;
                } else if (outwardEntry.inward_id) {
                  const originalInward = await (tx as any).inwardEntry.findUnique({
                    where: { id: String(outwardEntry.inward_id) }
                  });
                  if (originalInward) {
                    targetCustomerId = originalInward.customer_id;
                    targetCustomerName = originalInward.customer_name;
                  }
                }
              }
            }

            if (targetCustomerId && targetCustomerId.trim() !== '') {
              const custLastEntry = await (tx.ledgerEntry as any).findFirst({
                where: {
                  party_id: String(targetCustomerId),
                  company_id: updatedVoucher.company_id ? String(updatedVoucher.company_id) : undefined
                },
                orderBy: { created_at: 'desc' }
              });
              const custLastBalance = custLastEntry ? (custLastEntry.balance || 0) : 0;
              const custNewBalance = custLastBalance + newAmount;

              await (tx.ledgerEntry as any).create({
                data: {
                  id: crypto.randomUUID(),
                  party_id: String(targetCustomerId),
                  party_name: targetCustomerName || 'Customer',
                  party_type: 'customer',
                  company_id: updatedVoucher.company_id ? String(updatedVoucher.company_id) : null,
                  date: date ? new Date(date) : new Date(),
                  vch_type: 'JOURNAL',
                  vch_no: updatedVoucher.voucher_no || updatedVoucher.id,
                  type: 'debit',
                  amount: newAmount,
                  balance: custNewBalance,
                  description: `Processing Charge (Job Work Vendor: ${party_name || 'Vendor'}) for Inward: ${inwardEntry.inward_no || 'N/A'}`,
                  reference_id: updatedVoucher.voucher_no || updatedVoucher.id
                }
              });
            }
          }
        }
      }

      return updatedVoucher;
    }, {
      maxWait: 10000,
      timeout: 30000
    });

    res.json({ ...result, items: JSON.parse((result as any).items_json || '[]') });
  } catch (error: any) {
    console.error('❌ VOUCHER UPDATE ERROR:', error);
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
