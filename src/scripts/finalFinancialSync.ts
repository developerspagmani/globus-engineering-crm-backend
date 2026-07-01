import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function syncFinancials() {
  const companyId = 'comp_globus';
  const startTime = Date.now();
  console.log('💰 Starting FINAL Financial Sync for:', companyId);

  try {
    // 1. Clear existing financials
    await prisma.$transaction([
      (prisma.ledgerEntry as any).deleteMany({ where: { company_id: companyId } }),
      prisma.voucher.deleteMany({ where: { company_id: companyId } })
    ]);
    console.log('🧹 Cleared existing financials');

    // 2. Fetch all invoices with the newly restored names and addresses
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: { company_id: companyId },
      orderBy: { invoice_date: 'asc' }
    });

    console.log(`📑 Re-syncing ${invoices.length} invoices into Ledger/Vouchers...`);

    const customerBalances = new Map<number, number>();
    const ledgerEntriesToCreate: any[] = [];
    const vouchersToCreate: any[] = [];

    for (const inv of invoices) {
      const cId = inv.customer_id;
      if (!cId) continue;

      const currentBalance = customerBalances.get(cId) || 0;
      const amount = parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0;
      const paidAmount = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
      const cName = inv.customer_name || 'Unknown Customer';

      // A. Invoice Debit
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
        description: `Invoice: ${inv.invoice_no || inv.id}`,
        reference_id: String(inv.id),
        created_at: inv.app_created_at || new Date()
      });

      // B. Payment Credit
      if (paidAmount > 0) {
        const finalBalance = newBalanceAfterInvoice - paidAmount;
        customerBalances.set(cId, finalBalance);

        const vchId = crypto.randomUUID();
        const vchNo = `M-VCH-${inv.id}`;

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
          description_: `Payment for Invoice ${inv.invoice_no || inv.id}`,
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
          description: inv.cheque_no ? String(inv.cheque_no) : 'CASH',
          reference_id: vchId,
          created_at: inv.app_created_at || new Date()
        });
      }
    }

    // 3. Bulk Insert
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

    console.log(`🏁 FINAL Financial sync finished in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds.`);

  } catch (error) {
    console.error('❌ Sync Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

syncFinancials();
