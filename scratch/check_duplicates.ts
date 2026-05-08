import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const companyId = 'Globus'; // Assuming company ID is Globus from context
  
  const totalInvoices = await prisma.legacyInvoice.count();
  console.log('Total invoices in database:', totalInvoices);

  const globusInvoices = await prisma.legacyInvoice.count({
    where: {
      OR: [
        { company_id: 'Globus' },
        { company_id: 'globus' }
      ]
    }
  });
  console.log('Invoices for Globus (exact):', globusInvoices);

  const fuzzyGlobus = await prisma.legacyInvoice.count({
    where: {
      OR: [
        { company_id: 'Globus' },
        { company_id: { contains: 'Globus' } },
        { company_id: { contains: 'globus' } }
      ]
    }
  });
  console.log('Invoices for Globus (fuzzy):', fuzzyGlobus);

  // Check for duplicates by invoice_no
  const duplicates = await prisma.$queryRaw`
    SELECT invoice_no, COUNT(*) as count 
    FROM tbl_invoice 
    WHERE company_id LIKE '%Globus%'
    GROUP BY invoice_no 
    HAVING count > 1
    LIMIT 10
  `;
  console.log('Sample duplicates:', duplicates);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
