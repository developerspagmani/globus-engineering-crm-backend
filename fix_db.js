const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  const invoices = await prisma.legacyInvoice.findMany({
    where: { inward_id: '4fbf97d7-fa9a-4ddf-a3c6-76b80f1097b6' },
    orderBy: { id: 'desc' },
    take: 1
  });
  if (invoices.length === 0) return;
  const badInvoice = invoices[0];
  if (badInvoice.bill_type === 'without_process') {
    const items = JSON.parse(badInvoice.items_json);
    let changed = false;
    for (const item of items) {
      if (item.quantity > 0) {
        item.quantity = 0;
        changed = true;
      }
    }
    if (changed) {
      await prisma.legacyInvoice.update({
        where: { id: badInvoice.id },
        data: { items_json: JSON.stringify(items) }
      });
      console.log('Fixed bad invoice', badInvoice.id);
    } else {
      console.log('No fix needed');
    }
  }
}
fix().finally(() => prisma.$disconnect());
