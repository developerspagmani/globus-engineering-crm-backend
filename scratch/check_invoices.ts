import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const invoices = await prisma.legacyInvoice.findMany({
    where: {
      invoice_no: { in: [4, 5, 6] }
    }
  });
  console.log(JSON.stringify(invoices, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
