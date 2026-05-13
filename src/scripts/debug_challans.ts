import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkChallans() {
  const companyId = 'caterpiller'; // User mentioned caterpillar company
  console.log('--- Checking Challans for:', companyId, '---');
  
  const challans = await prisma.challan.findMany({
    where: {
      OR: [
        { company_id: companyId },
        { company_id: companyId.toLowerCase() },
        { company_id: companyId.toUpperCase() }
      ]
    },
    orderBy: { created_at: 'desc' },
    take: 10
  });

  console.log('Total found:', challans.length);
  challans.forEach(c => {
    console.log(`ID: ${c.id}, No: ${c.challan_no}, Inward: ${c.inward_id}, Items: ${c.items_json?.substring(0, 50)}...`);
  });

  const invoices = await (prisma as any).legacyInvoice.findMany({
    where: { 
       invoice_no: { in: [44, 45, 46] },
       company_id: companyId
    }
  });
  console.log('--- Invoices 44, 45, 46 ---');
  invoices.forEach((i: any) => {
    console.log(`Inv: ${i.invoice_no}, InwardID: ${i.inward_id}, DC: ${i.delivery_no}`);
  });
}

checkChallans()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
