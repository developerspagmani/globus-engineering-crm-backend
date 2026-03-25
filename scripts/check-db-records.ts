import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkVouchers() {
  try {
    const vouchers = await (prisma as any).voucher.findMany({
       take: 5,
       orderBy: { created_at: 'desc' }
    });
    console.log('--- RECENT VOUCHERS ---');
    console.log(JSON.stringify(vouchers, null, 2));
    
    const invoices = await (prisma as any).legacyInvoice.findMany({
       take: 5,
       orderBy: { app_created_at: 'desc' }
    });
    console.log('--- RECENT INVOICES ---');
    console.log(JSON.stringify(invoices, null, 2));

  } catch (err: any) {
    console.error('ERROR:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkVouchers();
