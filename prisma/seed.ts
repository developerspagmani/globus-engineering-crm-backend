import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database with full module list and items...');

  const allModules = [
    'mod_invoice', 'mod_customer', 'mod_inward', 'mod_outward', 
    'mod_ledger', 'mod_challan', 'mod_voucher', 'mod_employee', 
    'mod_sales_hub', 'mod_lead', 'mod_pending_payment', 'mod_vendor', 
    'mod_user_management', 'mod_items', 'mod_processes', 'mod_price_fixing'
  ];

  // 1. Companies
  await prisma.company.upsert({
    where: { id: 'comp_globus' },
    update: {
        active_modules: JSON.stringify(allModules)
    },
    create: {
      id: 'comp_globus',
      name: 'Globus Engineering Main',
      slug: 'globus-eng',
      plan: 'enterprise',
      active_modules: JSON.stringify(allModules)
    }
  });

  // 2. Users
  // Super Admin
  await prisma.user.upsert({
    where: { email: 'super@globus.com' },
    update: { role: 'super_admin' },
    create: {
      id: 'u_super',
      name: 'Super Admin',
      email: 'super@globus.com',
      password: 'password123',
      role: 'super_admin',
      permissions: JSON.stringify(['all']),
      module_permissions: JSON.stringify([{ moduleId: 'all', canRead: true, canCreate: true, canEdit: true, canDelete: true }])
    }
  });

  // Admin
  await prisma.user.upsert({
    where: { email: 'admin@globus.com' },
    update: { 
      role: 'company_admin',
      module_permissions: JSON.stringify([{ moduleId: 'all', canRead: true, canCreate: true, canEdit: true, canDelete: true }])
    },
    create: {
      id: 'u_admin',
      name: 'Globus Admin',
      email: 'admin@globus.com',
      password: 'password123',
      role: 'company_admin',
      company_id: 'comp_globus',
      permissions: JSON.stringify(['manage_company']),
      module_permissions: JSON.stringify([
        { moduleId: 'all', canRead: true, canCreate: true, canEdit: true, canDelete: true }
      ])
    }
  });

  // 3. Sample Invoice to show data is working
  await prisma.legacyInvoice.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      invoice_no: 8816,
      customer_id: 1,
      customer_name: 'TATA ADVANCED SYSTEMS LIMITED (SEZ UNIT II)',
      company_id: 'comp_globus',
      invoice_date: new Date('2024-03-16'),
      grand_total: '60000.00',
      total: '50000.00',
      status: 'SENT',
      items_json: JSON.stringify([
        { description: 'Industrial Pump Part A', qty: 10, price: 5000, item_total: 50000 }
      ])
    }
  });

  // 4. Sample Items
  await prisma.item.upsert({
    where: { id: 'item_1' },
    update: {},
    create: {
      id: 'item_1',
      item_code: 'PUMP-001',
      item_name: 'Industrial Centrifugal Pump',
      company_id: 'comp_globus'
    }
  });

  // 5. Sample Processes
  await prisma.process.upsert({
    where: { id: 'proc_1' },
    update: {},
    create: {
      id: 'proc_1',
      process_name: 'CNC Machining',
      company_id: 'comp_globus'
    }
  });

  console.log('✅ Seeding completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
