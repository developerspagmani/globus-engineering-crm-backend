import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const companyId = 'comp_globus';

async function main() {
  console.log('🚀 STARTING CLEAN LEGACY MIGRATION...');
  const startTime = Date.now();

  try {
    // 1. Ensure the default company exists
    await prisma.company.upsert({
      where: { id: companyId },
      update: { name: 'Globus Engineering' },
      create: {
        id: companyId,
        name: 'Globus Engineering',
        slug: 'globus-engineering',
        plan: 'enterprise'
      }
    });
    console.log('✅ Company comp_globus verified/created');

    // 2. Ensure default users exist
    const defaultUsers = [
      {
        id: 'u_super',
        name: 'Antigravity Super Admin',
        email: 'super@globus.com',
        role: 'super_admin'
      },
      {
        id: 'u_globus_admin',
        name: 'Globus Admin',
        email: 'admin@globus.com',
        role: 'company_admin',
        company_id: companyId
      }
    ];

    for (const u of defaultUsers) {
      await prisma.user.upsert({
        where: { id: u.id },
        update: { email: u.email },
        create: {
          id: u.id,
          name: u.name,
          email: u.email,
          password: '123', // Default password
          role: u.role,
          company_id: u.company_id || null
        }
      });
    }
    console.log('✅ Default users verified/created');

    // Clear existing migrated records to avoid duplication
    console.log('🧹 Clearing existing migrated records to avoid duplication...');
    await prisma.$transaction([
      (prisma as any).ledgerEntry.deleteMany({ where: { company_id: companyId } }),
      prisma.voucher.deleteMany({ where: { company_id: companyId } }),
      prisma.inwardEntry.deleteMany({ where: { company_id: companyId } }),
      prisma.priceFixing.deleteMany({ where: { company_id: companyId } }),
      prisma.item.deleteMany({ where: { company_id: companyId } }),
      prisma.process.deleteMany({ where: { company_id: companyId } }),
      prisma.vendor.deleteMany({ where: { company_id: companyId } }),
      prisma.legacyCustomer.deleteMany({ where: { company_id: companyId } }),
      prisma.legacyInvoice.deleteMany({ where: { company_id: companyId } }),
      prisma.purchaseBill.deleteMany({ where: { company_id: companyId } }),
    ]);
    console.log('✅ Existing records cleared.');

    // 3. Migrate raw customers to app_customers
    console.log('📦 Migrating legacy customers to app_customers...');
    const rawCustomers = await (prisma as any).tblCustomer.findMany();
    const customersToCreate = rawCustomers.map((c: any) => ({
      ...c,
      company_id: companyId,
      status: c.status || 'active'
    }));

    if (customersToCreate.length > 0) {
      const chunk = 500;
      for (let i = 0; i < customersToCreate.length; i += chunk) {
        await prisma.legacyCustomer.createMany({
          data: customersToCreate.slice(i, i + chunk),
          skipDuplicates: true
        });
      }
      console.log(`✅ Customers migrated: ${customersToCreate.length}`);
    }

    // 4. Migrate raw invoices to app_invoices
    console.log('📦 Migrating legacy invoices to app_invoices...');
    const rawInvoices = await (prisma as any).tblInvoice.findMany();
    const custNameMapForInv = new Map(rawCustomers.map((c: any) => [c.id, c.customer_name]));

    const invoicesToCreate = rawInvoices.map((inv: any) => ({
      ...inv,
      company_id: companyId,
      status: inv.status || 'BILLED',
      sub_total: inv.sub_total || null,
      tax_total: inv.tax_total || null,
      tax_rate: inv.tax_rate || 12,
      customer_name: inv.customer_name || custNameMapForInv.get(inv.customer_id) || 'Unknown Customer',
      items_json: null, // will be populated in step 9
      delivery_no: inv.id === 9789 ? 4603 : inv.delivery_no
    }));

    if (invoicesToCreate.length > 0) {
      const chunk = 500;
      for (let i = 0; i < invoicesToCreate.length; i += chunk) {
        await prisma.legacyInvoice.createMany({
          data: invoicesToCreate.slice(i, i + chunk),
          skipDuplicates: true
        });
      }
      console.log(`✅ Invoices migrated: ${invoicesToCreate.length}`);
    }

    // 5. Migrate Items
    console.log('📦 Migrating legacy items...');
    const legacyItems = await (prisma as any).tbl_item.findMany();
    await prisma.item.deleteMany({ where: { company_id: companyId } });

    const itemsToCreate = legacyItems
      .map((l: any) => ({
        id: `item_${l.id}`,
        item_code: l.item_code || "",
        item_name: l.item || 'Unnamed Item',
        company_id: companyId
      }));

    if (itemsToCreate.length > 0) {
      await prisma.item.createMany({ data: itemsToCreate, skipDuplicates: true });
      console.log(`✅ Items migrated: ${itemsToCreate.length}`);
    }

    // 6. Migrate Processes
    console.log('📦 Migrating legacy processes...');
    const legacyProcs = await (prisma as any).tbl_process.findMany();
    const procsToCreate = legacyProcs
      .filter((l: any) => l.process)
      .map((l: any) => ({
        id: `proc_${l.id}`,
        process_name: l.process,
        company_id: companyId
      }));

    if (procsToCreate.length > 0) {
      await prisma.process.createMany({ data: procsToCreate, skipDuplicates: true });
      console.log(`✅ Processes migrated: ${procsToCreate.length}`);
    }

    // 7. Migrate Vendors
    console.log('📦 Migrating legacy vendors...');
    const legacyVendors = await (prisma as any).tbl_vendor.findMany();
    const vendorsToCreate = legacyVendors
      .filter((l: any) => l.customer_name)
      .map((l: any) => ({
        id: `vend_${l.id}`,
        name: l.customer_name,
        email_: l.email_id1 || null,
        phone: l.phone_number1 || null,
        company: l.customer_name,
        company_id: companyId,
        status: 'active',
        area: l.area || null,
        city: l.city || null,
        contact_person1: l.contact_person1 || null,
        contact_person2: l.contact_person2 || null,
        contact_person3: l.contact_person3 || null,
        cst: l.cst || null,
        designation1: l.designation1 || null,
        designation2: l.designation2 || null,
        designation3: l.designation3 || null,
        email_id1: l.email_id1 || null,
        email_id2: l.email_id2 || null,
        email_id3: l.email_id3 || null,
        fax: l.fax || null,
        gst: l.gst || null,
        landline: l.land_line ? String(l.land_line) : null,
        phone_number1: l.phone_number1 || null,
        phone_number2: l.phone_number2 || null,
        phone_number3: l.phone_number3 || null,
        pin_code: l.pin_code ? String(l.pin_code) : null,
        state: l.state || null,
        state_code: l.state_code || null,
        street1: l.street1 || null,
        street2: l.street2 || null,
        tin: l.tin || null,
        vendor_id: String(l.id),
        vendor_name: l.customer_name
      }));

    if (vendorsToCreate.length > 0) {
      await prisma.vendor.createMany({ data: vendorsToCreate, skipDuplicates: true });
      console.log(`✅ Vendors migrated: ${vendorsToCreate.length}`);
    }

    // 8. Migrate Price Fixings
    console.log('📦 Migrating legacy price fixings...');
    const legacyPrices = await (prisma as any).tbl_item_price_fixing.findMany();
    if (legacyPrices.length > 0) {
      const [customers, items, processes] = await Promise.all([
        (prisma as any).legacyCustomer.findMany({ select: { id: true, customer_name: true } }),
        (prisma as any).tbl_item.findMany({ select: { id: true, item: true } }),
        (prisma as any).tbl_process.findMany({ select: { id: true, process: true } })
      ]);

      const custMap = new Map(customers.map((c: any) => [c.id, c.customer_name]));
      const itemMap = new Map(items.map((i: any) => [i.id, i.item]));
      const procMap = new Map(processes.map((p: any) => [p.id, p.process]));

      const pricesToCreate = [];
      for (const lp of legacyPrices) {
        const iId = `item_${lp.item_id}`;
        const pId = `proc_${lp.process_id}`;
        const cId = String(lp.customer_id);

        const cName = custMap.get(lp.customer_id) || `Customer #${lp.customer_id}`;
        const iName = itemMap.get(lp.item_id) || `Item #${lp.item_id}`;
        const pName = procMap.get(lp.process_id) || `Process #${lp.process_id || 'None'}`;

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

      if (pricesToCreate.length > 0) {
        await prisma.priceFixing.createMany({ data: pricesToCreate, skipDuplicates: true });
        console.log(`✅ Price fixings migrated: ${pricesToCreate.length}`);
      }
    }

    // 9. Migrate Legacy Invoice Items (tbl_invoice_item -> tbl_invoice.items_json)
    console.log('📦 Processing legacy invoice items to JSON...');
    const [invoiceItems, tblItems, tblProcs] = await Promise.all([
      (prisma as any).tbl_invoice_item.findMany(),
      (prisma as any).tbl_item.findMany({ select: { id: true, item: true } }),
      (prisma as any).tbl_process.findMany({ select: { id: true, process: true } })
    ]);

    const itemMap = new Map(tblItems.map((i: any) => [i.id, i.item]));
    const processMap = new Map(tblProcs.map((p: any) => [p.id, p.process]));

    const invoiceGroups = new Map<number, any[]>();
    for (const ii of invoiceItems) {
      if (!ii.invoice_no) continue;
      if (!invoiceGroups.has(ii.invoice_no)) {
        invoiceGroups.set(ii.invoice_no, []);
      }
      invoiceGroups.get(ii.invoice_no)!.push(ii);
    }

    console.log(`📦 Updating ${invoiceGroups.size} invoices with items_json...`);
    const invoiceIdsToMigrate = Array.from(invoiceGroups.keys());
    const batchSize = 100;
    for (let i = 0; i < invoiceIdsToMigrate.length; i += batchSize) {
      const chunk = invoiceIdsToMigrate.slice(i, i + batchSize);
      await Promise.all(
        chunk.map(async (invoiceId) => {
          const groupItems = invoiceGroups.get(invoiceId) || [];
          const parsedItems = groupItems.map(gi => ({
            description: itemMap.get(gi.item_id) || 'Unknown Item',
            process: processMap.get(gi.process_id) || 'Standard',
            qty: gi.qty || 0,
            wopQty: gi.wop_qty || 0,
            price: gi.price || 0,
            item_total: gi.item_total || 0
          }));

          await prisma.$executeRawUnsafe(
            'UPDATE app_invoices SET items_json = ? WHERE id = ?',
            JSON.stringify(parsedItems),
            invoiceId
          );
        })
      );
    }
    console.log('✅ Invoice items migrated.');

    // 10. Migrate Inwards
    console.log('📦 Migrating legacy inwards...');
    const legacyInwards = await (prisma as any).tbl_inward.findMany();
    const legacyCustomers = await (prisma as any).legacyCustomer.findMany({ select: { id: true, customer_name: true } });
    const custNameMap = new Map(legacyCustomers.map((c: any) => [c.id, c.customer_name]));
    const allLegacyInwardItems = await (prisma as any).tbl_inward_item.findMany();

    const inwardsToCreate = [];
    for (const lInw of legacyInwards) {
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

      const custName = lInw.customer_id ? custNameMap.get(lInw.customer_id) : null;

      inwardsToCreate.push({
        id: `inw_${lInw.id}`,
        inward_no: String(lInw.id),
        date: lInw.inward_date ? new Date(lInw.inward_date) : new Date(),
        dc_no: lInw.dc_no || '',
        dc_date: lInw.dc_date ? new Date(lInw.dc_date) : null,
        po_reference: lInw.po_no || '',
        po_date: lInw.po_date ? new Date(lInw.po_date) : null,
        customer_id: String(lInw.customer_id || ''),
        customer_name: custName ? String(custName) : 'Unknown Customer',
        company_id: companyId,
        status: 'pending',
        party_type: 'customer',
        items_json: JSON.stringify(enrichedItems)
      });
    }

    if (inwardsToCreate.length > 0) {
      const chunk = 200;
      for (let i = 0; i < inwardsToCreate.length; i += chunk) {
        await prisma.inwardEntry.createMany({
          data: inwardsToCreate.slice(i, i + chunk),
          skipDuplicates: true
        });
      }
      console.log(`✅ Inward entries migrated: ${inwardsToCreate.length}`);
    }

    // 11. Reconcile Invoice links to Inwards
    console.log('⚡ Resetting and linking legacy invoices to inward entries...');
    await (prisma as any).legacyInvoice.updateMany({
      where: { company_id: companyId },
      data: { inward_id: null }
    });

    const inwardMap = new Map();
    const allInwards = await prisma.inwardEntry.findMany({
      where: { company_id: companyId },
      select: { id: true, inward_no: true }
    });
    allInwards.forEach(inw => inwardMap.set(String(inw.inward_no), inw.id));

    let processedInvoices = 0;
    const linkPageSize = 1000;
    let linksUpdated = 0;

    while (true) {
      const pageInvoices = await (prisma as any).legacyInvoice.findMany({
        where: {
          company_id: companyId,
          OR: [{ inward_id: null }, { inward_id: '' }]
        },
        select: { id: true, inward_no: true },
        take: linkPageSize
      });

      if (pageInvoices.length === 0) break;

      const updateGroups = new Map<string, number[]>();
      for (const inv of pageInvoices) {
        const targetId = inwardMap.get(String(inv.inward_no));
        if (targetId) {
          if (!updateGroups.has(targetId)) updateGroups.set(targetId, []);
          updateGroups.get(targetId)?.push(inv.id);
        }
      }

      for (const [targetId, invoiceIds] of updateGroups.entries()) {
        const res = await (prisma as any).legacyInvoice.updateMany({
          where: { id: { in: invoiceIds } },
          data: { inward_id: targetId }
        });
        linksUpdated += res.count;
      }

      processedInvoices += pageInvoices.length;
      if (pageInvoices.length < linkPageSize) break;
    }
    console.log(`✅ Inward-Invoice links reconciled: ${linksUpdated}`);

    console.log('⚡ Step 12a: Marking completed invoices as fully paid in app_invoices...');
    const markPaidRes = await prisma.$executeRawUnsafe(
      `UPDATE app_invoices 
       SET paid_amount = grand_total 
       WHERE status = 'COMPLETED' 
         AND (paid_amount IS NULL OR paid_amount = '' OR paid_amount = '0.00' OR paid_amount = '0')`
    );
    console.log(`✅ Updated paid_amount for ${markPaidRes} completed invoices.`);

    console.log('📈 Step 12b: Migrating ledger entries and vouchers...');
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: { company_id: companyId },
      orderBy: { invoice_date: 'asc' },
      include: { customer: true }
    });

    const customerBalances = new Map<number, number>();
    const ledgerEntriesToCreate = [];
    const vouchersToCreate = [];

    for (const inv of invoices) {
      const cId = inv.customer_id;
      if (!cId) continue;

      const currentBalance = customerBalances.get(cId) || 0;
      const amount = parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0;
      const paidAmount = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;
      const cName = inv.customer_name || inv.customer?.customer_name || 'Unknown Customer';

      // Invoice Debit
      const newBalanceAfterInvoice = currentBalance + amount;
      customerBalances.set(cId, newBalanceAfterInvoice);

      ledgerEntriesToCreate.push({
        id: crypto.randomUUID(),
        party_id: String(cId),
        party_name: cName,
        party_type: 'customer',
        company_id: companyId,
        date: inv.invoice_date || new Date(),
        vch_type: 'INVOICE',
        vch_no: String(inv.invoice_no || inv.id),
        type: 'debit',
        amount: amount,
        balance: newBalanceAfterInvoice,
        description: `Migrated Invoice: ${inv.invoice_no || inv.id}`,
        reference_id: String(inv.id),
        created_at: inv.app_created_at || new Date()
      });

      // Receipt Credit & Voucher if invoice is paid/completed
      if (paidAmount > 0 || inv.status === 'COMPLETED') {
        const finalBalance = newBalanceAfterInvoice - paidAmount;
        customerBalances.set(cId, finalBalance);

        const vchId = `vch_${inv.id}`;
        const vchNo = `REC-${String(inv.invoice_no || inv.id).padStart(4, '0')}`;

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
          description: inv.cheque_no ? String(inv.cheque_no) : 'CASH',
          reference_id: vchId,
          created_at: inv.app_created_at || new Date()
        });
      }
    }

    if (ledgerEntriesToCreate.length > 0) {
      const chunk = 500;
      for (let i = 0; i < ledgerEntriesToCreate.length; i += chunk) {
        await (prisma.ledgerEntry as any).createMany({
          data: ledgerEntriesToCreate.slice(i, i + chunk)
        });
      }
      console.log(`✅ Ledger entries created: ${ledgerEntriesToCreate.length}`);
    }

    if (vouchersToCreate.length > 0) {
      const chunk = 500;
      for (let i = 0; i < vouchersToCreate.length; i += chunk) {
        await prisma.voucher.createMany({
          data: vouchersToCreate.slice(i, i + chunk)
        });
      }
      console.log(`✅ Vouchers created: ${vouchersToCreate.length}`);
    }

    // 13. Reconcile Inward statuses to match legacy open inwards (exactly 230 pending entries)
    console.log('⚡ Reconciling inward statuses...');
    try {
      const openInwardItems = await (prisma as any).tbl_inward_item.findMany({
        where: { status: 'OPEN' },
        select: { inward_no: true }
      });
      const legacyOpenNos = Array.from(new Set<number>(openInwardItems.map((item: any) => Number(item.inward_no)).filter(Boolean)));
      
      const globusOpenInwardNos: string[] = [];
      for (const openNo of legacyOpenNos) {
        const tblInward = await (prisma as any).tbl_inward.findUnique({
          where: { id: openNo }
        });
        if (!tblInward) continue;
        const customer = tblInward.customer_id ? await (prisma as any).legacyCustomer.findUnique({
          where: { id: tblInward.customer_id }
        }) : null;
        if (!customer || customer.company_id === companyId) {
          globusOpenInwardNos.push(String(openNo));
        }
      }

      await prisma.inwardEntry.updateMany({
        where: { company_id: companyId },
        data: { status: 'completed' }
      });

      const updateRes = await prisma.inwardEntry.updateMany({
        where: {
          company_id: companyId,
          inward_no: { in: globusOpenInwardNos }
        },
        data: { status: 'pending' }
      });

      console.log(`✅ Inward statuses reconciled to match legacy open inwards: ${updateRes.count} records marked as 'pending'.`);
    } catch (e: any) {
      console.log('⚠️ Could not reconcile inward statuses:', e.message);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🏁 CLEAN MIGRATION FINISHED IN ${duration} SECONDS.`);
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message || error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
