import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Database Count Diagnosis ---');
  
  // 1. Total Invoices for Globus (Assuming companyId contains 'GLOBUS')
  const totalGlobus = await prisma.legacyInvoice.count({
    where: {
      OR: [
        { company_id: { contains: 'GLOBUS' } },
        { company_id: { contains: 'globus' } }
      ]
    }
  });
  console.log('Total Invoices found for Globus:', totalGlobus);

  // 2. Total Invoices with any balance
  const allInvoices = await prisma.legacyInvoice.findMany({
    where: {
      OR: [
        { company_id: { contains: 'GLOBUS' } },
        { company_id: { contains: 'globus' } }
      ]
    },
    select: { id: true, grand_total: true, paid_amount: true }
  });

  const pending = allInvoices.filter(inv => {
    const grand = parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0;
    const paid = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
    return (grand - paid) > 0;
  });

  console.log('Invoices with Balance > 0 (Pending):', pending.length);
  
  // 3. Check for any invoices with different company IDs
  const distinctCompanies = await prisma.legacyInvoice.groupBy({
    by: ['company_id'],
    _count: { id: true }
  });
  console.log('Distinct Company IDs in database:', JSON.stringify(distinctCompanies, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
