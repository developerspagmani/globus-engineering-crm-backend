// test_inward_balance.ts or run a script using prisma in backend
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function test() {
  // Find an inward that has an invoice
  const invoiceWithInward = await (prisma as any).legacyInvoice.findFirst({
    where: {
      inward_id: { not: null }
    }
  });

  console.log("Sample invoice with inward:", {
    id: invoiceWithInward.id,
    invoice_no: invoiceWithInward.invoice_no,
    inward_id: invoiceWithInward.inward_id,
    inward_no: invoiceWithInward.inward_no,
    customer_id: invoiceWithInward.customer_id,
    items: invoiceWithInward.items_json
  });

  if (invoiceWithInward.inward_id) {
    const inward = await prisma.inwardEntry.findUnique({
      where: { id: invoiceWithInward.inward_id }
    });
    console.log("Linked inward entry:", {
      id: inward?.id,
      inward_no: inward?.inward_no,
      status: inward?.status,
      items: inward?.items_json
    });
  }

  // Also check recent invoices (IDs >= 9916 or latest created)
  const recentInvoices = await (prisma as any).legacyInvoice.findMany({
    where: { inward_id: { not: null } },
    orderBy: { id: 'desc' },
    take: 5
  });

  console.log("\n5 Recent invoices with inward_id:");
  for (const inv of recentInvoices) {
    const inward = await prisma.inwardEntry.findUnique({
      where: { id: inv.inward_id }
    });
    console.log(`Invoice #${inv.invoice_no || inv.id} -> inward_id: ${inv.inward_id}, inward status: ${inward?.status}`);
  }
}

test().finally(() => prisma.$disconnect());
