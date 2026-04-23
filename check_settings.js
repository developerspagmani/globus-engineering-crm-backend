
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany();
  console.log('COMPANIES IN DATABASE:');
  companies.forEach(c => {
    console.log(`- ID: ${c.id}, Name: ${c.name}`);
    console.log(`  Logo Present: ${!!c.logo}`);
    console.log(`  Secondary Logo Present: ${!!c.logo_secondary}`);
    console.log(`  Invoice Settings Present: ${!!c.invoice_settings}`);
    if (c.logo) {
      console.log(`  Logo Start: ${c.logo.substring(0, 50)}...`);
    }
    if (c.logo_secondary) {
      console.log(`  Secondary Logo Start: ${c.logo_secondary.substring(0, 50)}...`);
    }
    if (c.invoice_settings) {
      console.log(`  Settings JSON: ${c.invoice_settings}`);
    }
  });
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
