import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function syncFinancials() {
  const companyId = 'comp_globus';
  const startTime = Date.now();
  console.log('💰 Starting Financial Sync for:', companyId);

  try {
    // 1. Clear existing financials
    await prisma.$transaction([
      (prisma.ledgerEntry as any).deleteMany({ where: { company_id: companyId } }),
      prisma.voucher.deleteMany({ where: { company_id: companyId } })
    ]);
    console.log('🧹 Cleared existing financials');

    // 2. Fetch all invoices
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: { company_id: companyId },
      orderBy: { invoice_date: 'asc' },
      include: { customer: true }
    });

    const customerBalances = new Map<number, number>();
    const ledgerEntriesToCreate: any[] = [];
    const vouchersToCreate: any[] = [];

    for (const inv of invoices) {
      const cId = inv.customer_id;
      if (!cId) continue;

      const currentBalance = customerBalances.get(cId) || 0;
      const paidAmount = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
      const cName = inv.customer_name || inv.customer?.customer_name || 'Unknown Customer';

      // B. Payment Credit
      if (paidAmount > 0) {
        const finalBalance = currentBalance - paidAmount;
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
          description: `Receipt for Inv: ${inv.invoice_no || inv.id}`,
          reference_id: vchId,
          created_at: inv.app_created_at || new Date()
        });
      }
    }

    // 3. Bulk Insert
    if (ledgerEntriesToCreate.length > 0) {
      console.log(`📦 Inserting ${ledgerEntriesToCreate.length} ledger entries...`);
      const chunkSize = 500;
      for (let i = 0; i < ledgerEntriesToCreate.length; i += chunkSize) {
        await (prisma.ledgerEntry as any).createMany({
          data: ledgerEntriesToCreate.slice(i, i + chunkSize)
        });
      }
    }

    if (vouchersToCreate.length > 0) {
      console.log(`📦 Inserting ${vouchersToCreate.length} vouchers...`);
      const chunkSize = 500;
      for (let i = 0; i < vouchersToCreate.length; i += chunkSize) {
        await prisma.voucher.createMany({
          data: vouchersToCreate.slice(i, i + chunkSize)
        });
      }
    }

    console.log(`🏁 Financial sync finished in ${((Date.now() - startTime) / 1000).toFixed(2)}s.`);
  } catch (error) {
    console.error('❌ Sync Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

syncFinancials();
