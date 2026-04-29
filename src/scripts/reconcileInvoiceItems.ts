import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fastReconcileInvoiceItems() {
  const companyId = 'comp_globus';
  const startTime = Date.now();
  console.log('🚀 Starting CONCURRENT Invoice Item Reconciliation for:', companyId);

  try {
    // 1. Load ALL reference data at once
    console.log('📡 Loading reference data...');
    const [legacyItems, legacyProcs, allInvoiceItems] = await Promise.all([
      (prisma as any).tbl_item.findMany({ select: { id: true, item: true } }),
      (prisma as any).tbl_process.findMany({ select: { id: true, process: true } }),
      (prisma as any).tbl_invoice_item.findMany()
    ]);
    
    const itemMap = new Map(legacyItems.map((i: any) => [i.id, i.item]));
    const procMap = new Map(legacyProcs.map((p: any) => [p.id, p.process]));

    // Group items by invoice ID in memory
    const itemsGroupedByInvoiceId = new Map<number, any[]>();
    for (const it of allInvoiceItems) {
      if (!itemsGroupedByInvoiceId.has(it.invoice_no)) {
        itemsGroupedByInvoiceId.set(it.invoice_no, []);
      }
      itemsGroupedByInvoiceId.get(it.invoice_no)?.push(it);
    }
    console.log(`📡 Grouped ${allInvoiceItems.length} items for ${itemsGroupedByInvoiceId.size} invoices.`);

    // 2. Fetch all invoices for the company
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: { company_id: companyId },
      select: { id: true }
    });

    console.log(`📑 Processing ${invoices.length} invoices...`);

    let updatedCount = 0;
    const CONCURRENCY = 30; // Concurrency limit

    for (let i = 0; i < invoices.length; i += CONCURRENCY) {
      const chunk = invoices.slice(i, i + CONCURRENCY);
      
      await Promise.all(chunk.map(async (inv: any) => {
        const items = itemsGroupedByInvoiceId.get(inv.id) || [];

        if (items.length > 0) {
          const enrichedItems = items.map((it: any) => ({
            id: it.id,
            description: itemMap.get(it.item_id) || 'Unknown Item',
            process_name: procMap.get(it.process_id) || 'Standard',
            quantity: it.qty || 0,
            wopQty: it.wop_qty || 0,
            unitPrice: it.price || 0,
            amount: it.item_total || 0
          }));

          await (prisma as any).legacyInvoice.update({
            where: { id: inv.id },
            data: { items_json: JSON.stringify(enrichedItems) }
          });
        }
      }));

      updatedCount += chunk.length;
      if (updatedCount % 300 === 0 || updatedCount === invoices.length) {
        console.log(`📈 Progress: ${updatedCount}/${invoices.length} invoices processed...`);
      }
    }

    console.log(`🏁 Finished! Reconciled items for ${updatedCount} invoices.`);
    console.log(`⏱️ Total time: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

  } catch (error) {
    console.error('❌ Reconciliation Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fastReconcileInvoiceItems();
