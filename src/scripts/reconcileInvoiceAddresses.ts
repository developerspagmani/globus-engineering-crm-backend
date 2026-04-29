import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function reconcileInvoiceDetails() {
  const companyId = 'comp_globus';
  const startTime = Date.now();
  console.log('🚀 Starting Invoice Address & GST Reconciliation for:', companyId);

  try {
    // 1. Load all customers into memory for fast lookup
    console.log('📡 Loading customer master data...');
    const legacyCustomers = await (prisma as any).legacyCustomer.findMany();
    const customerMap = new Map();
    for (const c of legacyCustomers) {
      customerMap.set(c.id, {
        address: `${c.street1 || ''} ${c.street2 || ''} ${c.city || ''} ${c.state || ''} ${c.pin_code || ''}`.trim(),
        gstin: c.gst || '',
        state: c.state || '',
        customer_name: c.customer_name || ''
      });
    }
    console.log(`📡 Loaded ${customerMap.size} customers.`);

    // 2. Fetch all invoices for the company
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: { company_id: companyId },
      select: { id: true, customer_id: true }
    });

    console.log(`📑 Processing ${invoices.length} invoices for Address/GST...`);

    let updatedCount = 0;
    const CONCURRENCY = 50;

    for (let i = 0; i < invoices.length; i += CONCURRENCY) {
      const chunk = invoices.slice(i, i + CONCURRENCY);
      
      await Promise.all(chunk.map(async (inv: any) => {
        const cust = customerMap.get(inv.customer_id);

        if (cust) {
          await (prisma as any).legacyInvoice.update({
            where: { id: inv.id },
            data: { 
              address: cust.address,
              gstin: cust.gstin,
              state: cust.state,
              customer_name: cust.customer_name
            }
          });
          updatedCount++;
        }
      }));

      if (updatedCount % 500 === 0 || i + CONCURRENCY >= invoices.length) {
        console.log(`📈 Progress: ${updatedCount}/${invoices.length} addresses updated...`);
      }
    }

    console.log(`🏁 Finished! Updated details for ${updatedCount} invoices.`);
    console.log(`⏱️ Total time: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

  } catch (error) {
    console.error('❌ Reconciliation Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

reconcileInvoiceDetails();
