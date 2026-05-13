import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import { logAudit } from '../../utils/auditLogger';
import crypto from 'crypto';

export const migrateLegacyData = async (req: Request, res: Response) => {
  const companyId = 'comp_globus';
  const startTime = Date.now();
  console.log('🚀 Starting Optimized Migration for:', companyId);

  const results: any = {
    priceFixings: 0, employees: 0, ledgerEntries: 0, vouchers: 0
  };

  try {
    // 1 & 2. Fast updates for Customers and Invoices
    const [custRes, invRes] = await Promise.all([
      (prisma as any).legacyCustomer.updateMany({
        where: { OR: [{ company_id: null }, { company_id: '' }] },
        data: { company_id: companyId }
      }),
      (prisma as any).legacyInvoice.updateMany({
        where: { OR: [{ company_id: null }, { company_id: '' }] },
        data: { company_id: companyId }
      })
    ]);
    results.customers = custRes.count;
    results.invoices = invRes.count;
    console.log(`✅ Core: ${results.customers} Cust, ${results.invoices} Inv`);

    // 3. Migrate Items in bulk
    const legacyItems = await (prisma as any).tbl_item.findMany();
    const existingItems = await prisma.item.findMany({ where: { company_id: companyId }, select: { item_name: true } });
    const existingNames = new Set(existingItems.map(i => i.item_name));

    const itemsToCreate = legacyItems
      .filter((l: any) => l.item && !existingNames.has(l.item))
      .map((l: any) => ({
        id: `item_${l.id}`,
        item_code: l.item_code || `ITM-${l.id}`,
        item_name: l.item,
        company_id: companyId
      }));

    if (itemsToCreate.length > 0) {
      await prisma.item.createMany({ data: itemsToCreate, skipDuplicates: true });
      results.items = itemsToCreate.length;
    }
    console.log('✅ Items:', results.items);

    // 4. Migrate Processes in bulk
    const legacyProcs = await (prisma as any).tbl_process.findMany();
    const existingProcs = await prisma.process.findMany({ where: { company_id: companyId }, select: { process_name: true } });
    const existingPNames = new Set(existingProcs.map(p => p.process_name));

    const procsToCreate = legacyProcs
      .filter((l: any) => l.process && !existingPNames.has(l.process))
      .map((l: any) => ({
        id: `proc_${l.id}`,
        process_name: l.process,
        company_id: companyId
      }));

    if (procsToCreate.length > 0) {
      await prisma.process.createMany({ data: procsToCreate, skipDuplicates: true });
      results.processes = procsToCreate.length;
    }
    console.log('✅ Processes:', results.processes);

    // 5. Migrate Vendors
    const legacyVendors = await (prisma as any).tbl_vendor.findMany();
    const existingVends = await prisma.vendor.findMany({ where: { company_id: companyId }, select: { name: true } });
    const existingVNames = new Set(existingVends.map(v => v.name));

    const vendorsToCreate = legacyVendors
      .filter((l: any) => l.customer_name && !existingVNames.has(l.customer_name))
      .map((l: any) => ({
        id: `vend_${l.id}`,
        name: l.customer_name,
        company_id: companyId,
        status: 'active',
        city: l.city,
        phone: l.phone_number1 || l.phone
      }));

    if (vendorsToCreate.length > 0) {
      await prisma.vendor.createMany({ data: vendorsToCreate, skipDuplicates: true });
      results.vendors = vendorsToCreate.length;
    }
    console.log('✅ Vendors:', results.vendors);

    // 6. Migrate Inwards (Bulk Create)
    console.log('📦 Fetching legacy inwards...');
    const legacyInwards = await (prisma as any).tbl_inward.findMany();
    const existingInwards = await prisma.inwardEntry.findMany({ where: { company_id: companyId }, select: { inward_no: true } });
    const existingInwNos = new Set(existingInwards.map(ei => ei.inward_no));

    const inwardsToCreate = [];
    const allLegacyInwardItems = await (prisma as any).tbl_inward_item.findMany();

    for (const lInw of legacyInwards) {
      if (!existingInwNos.has(String(lInw.id))) {
        const relatedItems = allLegacyInwardItems.filter((li: any) => li.inward_no === lInw.id);
        const enrichedItems = relatedItems.map((li: any) => {
          const item = legacyItems.find((i: any) => i.id === li.item_id);
          const proc = legacyProcs.find((p: any) => p.id === li.process_id);
          return {
            description: item?.item || 'Unknown Item',
            process: proc?.process || 'Standard',
            quantity: li.qty || 0,
            unit: 'pcs'
          };
        });

        inwardsToCreate.push({
          id: crypto.randomUUID(),
          inward_no: String(lInw.id),
          date: lInw.inward_date ? new Date(lInw.inward_date) : new Date(),
          dc_no: lInw.dc_no,
          dc_date: lInw.dc_date ? new Date(lInw.dc_date) : null,
          po_reference: lInw.po_no,
          po_date: lInw.po_date ? new Date(lInw.po_date) : null,
          customer_id: String(lInw.customer_id || ''),
          company_id: companyId,
          status: 'pending',
          items_json: JSON.stringify(enrichedItems)
        });
      }
    }

    if (inwardsToCreate.length > 0) {
      console.log(`📦 Creating ${inwardsToCreate.length} inward entries...`);
      // Chunk inward creation to prevent packet size errors
      const chunkSize = 100;
      for (let i = 0; i < inwardsToCreate.length; i += chunkSize) {
        await prisma.inwardEntry.createMany({
          data: inwardsToCreate.slice(i, i + chunkSize),
          skipDuplicates: true
        });
      }
      results.inwards = inwardsToCreate.length;
    }
    console.log('✅ Inwards created');

    // 7. SAFE & PAGED LINKING: Process invoices in smaller pages
    console.log('⚡ Reconciling Invoice links (Paged Batching)...');

    // Create a fast lookup map for inwards
    const inwardMap = new Map();
    const allInwards = await prisma.inwardEntry.findMany({
      where: { company_id: companyId },
      select: { id: true, inward_no: true }
    });
    allInwards.forEach(inw => inwardMap.set(String(inw.inward_no), inw.id));
    console.log(`📡 Inward Map Ready: ${inwardMap.size} entries`);

    let processedInvoices = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      // Fetch 1000 invoices at a time that need linking
      const pageInvoices = await (prisma as any).legacyInvoice.findMany({
        where: {
          company_id: companyId,
          OR: [{ inward_id: null }, { inward_id: '' }]
        },
        select: { id: true, inward_no: true },
        take: PAGE_SIZE
      });

      if (pageInvoices.length === 0) break;

      // Group these 1000 invoices by their target inward_id
      const updateGroups = new Map<string, number[]>();
      for (const inv of pageInvoices) {
        const targetId = inwardMap.get(String(inv.inward_no));
        if (targetId) {
          if (!updateGroups.has(targetId)) updateGroups.set(targetId, []);
          updateGroups.get(targetId)?.push(inv.id);
        }
      }

      // Execute updates for this page
      for (const [targetId, invoiceIds] of updateGroups.entries()) {
        const res = await (prisma as any).legacyInvoice.updateMany({
          where: { id: { in: invoiceIds } },
          data: { inward_id: targetId }
        });
        results.linksUpdated += res.count;
      }

      processedInvoices += pageInvoices.length;
      console.log(`📈 Progress: ${processedInvoices} invoices checked...`);

      // If we got fewer than PAGE_SIZE, we are at the end
      if (pageInvoices.length < PAGE_SIZE) break;
    }
    console.log(`✅ Links reconciled: ${results.linksUpdated}`);

    // 8. Migrate Price Fixings (Bulk Optimization)
    console.log('📦 Migrating Price Fixings (Bulk)...');
    const legacyPrices = await (prisma as any).tbl_item_price_fixing.findMany();

    if (legacyPrices.length > 0) {
      // Load all reference data at once
      const [customers, items, processes, existingPrices] = await Promise.all([
        (prisma as any).legacyCustomer.findMany({ select: { id: true, customer_name: true } }),
        (prisma as any).tbl_item.findMany({ select: { id: true, item: true } }),
        (prisma as any).tbl_process.findMany({ select: { id: true, process: true } }),
        prisma.priceFixing.findMany({ where: { company_id: companyId }, select: { customer_id: true, item_id: true, process_id: true } })
      ]);

      const custMap = new Map(customers.map((c: any) => [c.id, c.customer_name]));
      const itemMap = new Map(items.map((i: any) => [i.id, i.item]));
      const procMap = new Map(processes.map((p: any) => [p.id, p.process]));
      const priceKey = (c: any, i: any, p: any) => `${c}|${i}|${p}`;
      const existingKeys = new Set(existingPrices.map(ep => priceKey(ep.customer_id, ep.item_id, ep.process_id)));

      const pricesToCreate = [];
      for (const lp of legacyPrices) {
        const iId = `item_${lp.item_id}`;
        const pId = `proc_${lp.process_id}`;
        const cId = String(lp.customer_id);

        if (!existingKeys.has(priceKey(cId, iId, pId))) {
          const cName = custMap.get(lp.customer_id);
          const iName = itemMap.get(lp.item_id);
          const pName = procMap.get(lp.process_id);

          if (cName && iName && pName) {
            pricesToCreate.push({
              id: `price_${lp.id}`,
              customer_id: cId,
              customer_name: String(cName),
              item_id: iId,
              item_name: String(iName),
              process_id: pId,
              process_name: String(pName),
              price: lp.price || 0,
              company_id: companyId
            });
          }
        }
      }

      if (pricesToCreate.length > 0) {
        console.log(`📦 Creating ${pricesToCreate.length} price fixing entries...`);
        await prisma.priceFixing.createMany({ data: pricesToCreate, skipDuplicates: true });
        results.priceFixings = pricesToCreate.length;
      }
    }
    console.log('✅ Price Fixings completed');

    // 9. Employees
    const empRes = await (prisma as any).legacyEmployee.updateMany({
      where: { OR: [{ company_id: null }, { company_id: '' }] },
      data: { company_id: companyId }
    });
    results.employees = empRes.count;

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🏁 Migration finished in ${duration} seconds.`);

    await logAudit({
      action: 'MIGRATE_FULL',
      entity: 'System',
      entity_id: 'migration_phase_2',
      user_id: (req as any).user?.id || 'admin',
      user_name: (req as any).user?.name || 'Admin',
      company_id: companyId,
      details: results
    });

    res.json({ success: true, message: 'Migration completed.', data: results });

  } catch (error: any) {
    console.error('❌ Migration Error:', error);
    res.status(500).json({ error: 'Migration failed', detail: error.message });
  }
};

export const syncFinancials = async (req: Request, res: Response) => {
  const companyId = 'comp_globus';
  const startTime = Date.now();
  console.log('💰 Starting Financial Sync for:', companyId);

  const results = { ledgerEntries: 0, vouchers: 0 };

  try {
    // 1. Clear existing financials for a clean slate (only those linked to legacy data or company)
    await prisma.$transaction([
      (prisma.ledgerEntry as any).deleteMany({ where: { company_id: companyId } }),
      prisma.voucher.deleteMany({ where: { company_id: companyId } })
    ]);
    console.log('🧹 Cleared existing financials');

    // 2. Fetch all invoices for this company, ordered by date to build running balance
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: { company_id: companyId },
      orderBy: { invoice_date: 'asc' },
      include: { customer: true }
    });

    const customerBalances = new Map<number, number>();

    const ledgerEntriesToCreate: any[] = [];
    const vouchersToCreate: any[] = [];

    for (const inv of invoices) {
      const cId = inv.customer_id;
      if (!cId) continue;

      // A. Invoice Debit Entry Removed as per voucher-only ledger policy.
      // We still track the balance for local calculation if needed, 
      // but we only record the impact of the payment (voucher).
      const currentBalance = customerBalances.get(cId) || 0;
      const paidAmount = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
      const cName = inv.customer_name || inv.customer?.customer_name || 'Unknown Customer';

      // B. Add Payment Credit Entry & Voucher if paid
      if (paidAmount > 0) {
        const finalBalance = currentBalance - paidAmount;
        customerBalances.set(cId, finalBalance);

        const vchId = crypto.randomUUID();
        const vchNo = `M-VCH-${inv.id}`;

        vouchersToCreate.push({
          id: vchId,
          voucher_no: vchNo,
          date: inv.voucher_date || inv.invoice_date || new Date(),
          type: 'receipt',
          party_id: String(cId),
          party_name: cName,
          party_type: 'customer',
          company_id: companyId,
          amount: paidAmount,
          payment_mode: inv.cheque_no ? 'cheque' : 'cash',
          reference_no: String(inv.invoice_no || inv.id),
          cheque_no: inv.cheque_no || '',
          description_: `Migrated Payment for Invoice ${inv.invoice_no || inv.id}`,
          status: 'posted',
          created_at: inv.app_created_at || new Date()
        });

        ledgerEntriesToCreate.push({
          id: crypto.randomUUID(),
          party_id: String(cId),
          party_name: cName,
          party_type: 'customer',
          company_id: companyId,
          date: inv.voucher_date || inv.invoice_date || new Date(),
          vch_type: 'RECEIPT',
          vch_no: vchNo,
          type: 'credit',
          amount: paidAmount,
          balance: finalBalance,
          description: `Migrated Receipt for Inv: ${inv.invoice_no || inv.id}`,
          reference_id: vchId,
          created_at: inv.app_created_at || new Date()
        });
      }
    }

    // 3. Bulk Insert
    if (ledgerEntriesToCreate.length > 0) {
      console.log(`📦 Inserting ${ledgerEntriesToCreate.length} ledger entries...`);
      const chunkSize = 500;
      for (let i = 0; i < ledgerEntriesToCreate.length; i += chunkSize) {
        await (prisma.ledgerEntry as any).createMany({
          data: ledgerEntriesToCreate.slice(i, i + chunkSize)
        });
      }
      results.ledgerEntries = ledgerEntriesToCreate.length;
    }

    if (vouchersToCreate.length > 0) {
      console.log(`📦 Inserting ${vouchersToCreate.length} vouchers...`);
      const chunkSize = 500;
      for (let i = 0; i < vouchersToCreate.length; i += chunkSize) {
        await prisma.voucher.createMany({
          data: vouchersToCreate.slice(i, i + chunkSize)
        });
      }
      results.vouchers = vouchersToCreate.length;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🏁 Financial sync finished in ${duration} seconds.`);

    res.json({ success: true, message: 'Financial sync completed.', data: results });

  } catch (error: any) {
    console.error('❌ Sync Error:', error);
    res.status(500).json({ error: 'Financial sync failed', detail: error.message });
  }
};

export const rollbackLegacyMigration = async (req: Request, res: Response) => {
  const companyId = 'comp_globus';
  const results: any = {};

  try {
    // 1. Reset Customers and Invoices
    const resCust = await (prisma as any).legacyCustomer.updateMany({
      where: { company_id: companyId },
      data: { company_id: null }
    });

    const resInv = await (prisma as any).legacyInvoice.updateMany({
      where: { company_id: companyId },
      data: { company_id: null, inward_id: null }
    });

    // 2. Clear new tables created by migration (using our prefixed IDs)
    await prisma.item.deleteMany({ where: { id: { startsWith: 'item_' }, company_id: companyId } });
    await prisma.process.deleteMany({ where: { id: { startsWith: 'proc_' }, company_id: companyId } });
    await prisma.vendor.deleteMany({ where: { id: { startsWith: 'vend_' }, company_id: companyId } });
    await prisma.inwardEntry.deleteMany({ where: { company_id: companyId } });

    res.json({
      success: true,
      message: 'Rollback completed. Database has been restored to its previous state.',
      data: { customers: resCust.count, invoices: resInv.count }
    });

  } catch (error: any) {
    res.status(500).json({ error: 'Rollback failed', detail: error.message });
  }
};
