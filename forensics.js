const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkGhostInvoice() {
  try {
    console.log("Searching for Invoice 0041...");
    const invoice = await prisma.legacyInvoice.findFirst({
      where: { invoice_no: 41 },
      select: { id: true, created_at: true, customer_name: true, items_json: true }
    });

    if (!invoice) {
      console.log("Invoice 0041 not found in database.");
      return;
    }

    console.log("Found Invoice:", invoice);

    console.log("Checking Audit Logs for this invoice...");
    const logs = await prisma.auditLog.findMany({
      where: { entity_id: String(invoice.id) },
      orderBy: { created_at: 'desc' }
    });

    console.log("Audit Logs:", JSON.stringify(logs, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkGhostInvoice();
