import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const search = 'madhu';
  const companyId = 'globus'; // Test with a known company ID if possible

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

  if (search) {
    where.AND.push({
      OR: [
        { customer_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { gst: { contains: search, mode: 'insensitive' } }
      ]
    });
  }

  try {
    console.log('Running search query...');
    const customers = await prisma.legacyCustomer.findMany({
      where,
      take: 10
    });
    console.log('Search results:', customers.length);
    process.exit(0);
  } catch (error) {
    console.error('Error during search:', error);
    process.exit(1);
  }
}

main();
