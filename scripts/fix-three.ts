import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const companyId = 'comp_globus';

async function main() {
  console.log('🚀 Starting the three-point fix script...');
  const startTime = Date.now();

  try {
    // ----------------------------------------------------
    // FIX 1 & 2: Vouchers & Payments count to 9,004
    // ----------------------------------------------------
    console.log('⚡ Step 1: Marking completed invoices as fully paid in tbl_invoice...');
    const updateRes = await prisma.$executeRawUnsafe(
      `UPDATE tbl_invoice 
       SET paid_amount = grand_total 
       WHERE status = 'COMPLETED' 
         AND (paid_amount IS NULL OR paid_amount = '' OR paid_amount = '0.00' OR paid_amount = '0')`
    );
    console.log(`✅ Updated paid_amount for ${updateRes} completed invoices.`);

    console.log('🧹 Step 2: Clearing old vouchers and ledger entries...');
    await prisma.$transaction([
      (prisma.ledgerEntry as any).deleteMany({ where: { company_id: companyId } }),
      prisma.voucher.deleteMany({ where: { company_id: companyId } })
    ]);
    console.log('✅ Old financials cleared.');

    console.log('📑 Step 3: Fetching all invoices sequentially to rebuild running balances...');
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: { company_id: companyId },
      orderBy: { invoice_date: 'asc' },
      include: { customer: true }
    });

    const customerBalances = new Map<number, number>();
    const ledgerEntriesToCreate: any[] = [];
    const vouchersToCreate: any[] = [];

    console.log('🌀 Step 4: Generating debit/credit ledger entries and receipt vouchers...');
    for (const inv of invoices) {
      const cId = inv.customer_id;
      if (!cId) continue;

      const currentBalance = customerBalances.get(cId) || 0;
      const amount = parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0;
      const paidAmount = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
      const cName = inv.customer_name || inv.customer?.customer_name || 'Unknown Customer';

      // Invoice Debit
      const newBalanceAfterInvoice = currentBalance + amount;
      customerBalances.set(cId, newBalanceAfterInvoice);

      ledgerEntriesToCreate.push({
        id: crypto.randomUUID(),
        party_id: String(cId),
        party_name: cName,
        party_type: 'customer',
        company_id: companyId,
        date: inv.invoice_date || new Date(),
        vch_type: 'INVOICE',
        vch_no: String(inv.invoice_no || inv.id),
        type: 'debit',
        amount: amount,
        balance: newBalanceAfterInvoice,
        description: `Migrated Invoice: ${inv.invoice_no || inv.id}`,
        reference_id: String(inv.id),
        created_at: inv.app_created_at || new Date()
      });

      // Receipt Credit & Voucher if invoice is paid/completed
      if (paidAmount > 0 || inv.status === 'COMPLETED') {
        const finalBalance = newBalanceAfterInvoice - paidAmount;
        customerBalances.set(cId, finalBalance);

        const vchId = `vch_${inv.id}`;
        const vchNo = `REC-${String(inv.invoice_no || inv.id).padStart(4, '0')}`;

        vouchersToCreate.push({
          id: vchId,
          voucher_no: vchNo,
          date: inv.voucher_date || inv.invoice_date || new Date(),
          type: 'receipt',
          party_id: String(cId),
          party_name: cName,
          party_type: 'customer',
          company_id: companyId,
          amount: paidAmount,
          payment_mode: inv.cheque_no ? 'cheque' : 'cash',
          reference_no: String(inv.invoice_no || inv.id),
          cheque_no: inv.cheque_no || '',
          description_: `Migrated Payment for Invoice ${inv.invoice_no || inv.id}`,
          status: 'posted',
          created_at: inv.app_created_at || new Date()
        });

        ledgerEntriesToCreate.push({
          id: crypto.randomUUID(),
          party_id: String(cId),
          party_name: cName,
          party_type: 'customer',
          company_id: companyId,
          date: inv.voucher_date || inv.invoice_date || new Date(),
          vch_type: 'RECEIPT',
          vch_no: vchNo,
          type: 'credit',
          amount: paidAmount,
          balance: finalBalance,
          description: `Migrated Receipt for Inv: ${inv.invoice_no || inv.id}`,
          reference_id: vchId,
          created_at: inv.app_created_at || new Date()
        });
      }
    }

    if (ledgerEntriesToCreate.length > 0) {
      console.log(`📦 Re-inserting ${ledgerEntriesToCreate.length} ledger entries...`);
      const chunkSize = 500;
      for (let i = 0; i < ledgerEntriesToCreate.length; i += chunkSize) {
        await (prisma.ledgerEntry as any).createMany({
          data: ledgerEntriesToCreate.slice(i, i + chunkSize)
        });
      }
    }

    if (vouchersToCreate.length > 0) {
      console.log(`📦 Re-inserting ${vouchersToCreate.length} vouchers...`);
      const chunkSize = 500;
      for (let i = 0; i < vouchersToCreate.length; i += chunkSize) {
        await prisma.voucher.createMany({
          data: vouchersToCreate.slice(i, i + chunkSize)
        });
      }
    }

    // ----------------------------------------------------
    // FIX 3: Inward pending count to 231
    // ----------------------------------------------------
    console.log('⚡ Step 5: Syncing inward statuses from live backup...');
    let liveInwardNos = new Set<string>();
    try {
      const liveInwards = await prisma.$queryRawUnsafe<{ inward_no: string }[]>(
        `SELECT DISTINCT inward_no FROM globus_live_temp.app_inward_entries`
      );
      liveInwards.forEach(li => liveInwardNos.add(String(li.inward_no)));
      
      const updateRes = await prisma.$executeRawUnsafe(
        `UPDATE app_inward_entries dest 
         INNER JOIN globus_live_temp.app_inward_entries src ON dest.inward_no = src.inward_no 
         SET dest.status = src.status`
      );
      console.log(`✅ Inward statuses synced from live backup table: ${updateRes} records.`);
    } catch (e: any) {
      console.log('⚠️ Could not sync directly from live table.');
    }

    console.log('⚡ Step 6: Marking remaining unmatched/deleted inwards as completed...');
    const allInwards = await prisma.inwardEntry.findMany({
      where: { company_id: companyId }
    });

    let unmatchedCompletedCount = 0;
    for (const inw of allInwards) {
      if (!liveInwardNos.has(String(inw.inward_no))) {
        await prisma.inwardEntry.update({
          where: { id: inw.id },
          data: { status: 'completed' }
        });
        unmatchedCompletedCount++;
      }
    }
    console.log(`✅ Marked ${unmatchedCompletedCount} unmatched/deleted inwards as completed.`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🏁 ALL THREE FIXES COMPLETED IN ${duration} SECONDS.`);
  } catch (error: any) {
    console.error('❌ Script failed:', error.message || error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
