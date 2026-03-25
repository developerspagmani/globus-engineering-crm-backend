import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const ALL_MODULES = [
  'mod_items',
  'mod_processes',
  'mod_customer',
  'mod_vendor',
  'mod_price_fixing',
  'mod_inward',
  'mod_outward',
  'mod_invoice',
  'mod_pending_payment',
  'mod_ledger',
  'mod_challan',
  'mod_voucher',
  'mod_employee',
  'mod_lead',
  'mod_sales_hub',
  'mod_user_management'
];

async function main() {
  const f1Id = '7cf46a0d-72b5-45a7-aeec-1bcb4e2fd838';
  console.log('Activating all modules for F1 Systems:', f1Id);
  
  await prisma.company.update({
    where: { id: f1Id },
    data: {
      active_modules: JSON.stringify(ALL_MODULES)
    }
  });
  
  console.log('SUCCESS: All modules activated for F1 Systems.');
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
