const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe(`
    SELECT TABLE_NAME, ENGINE
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = 'u148315648_globus_db'
  `);
  console.log(tables);
}

main().catch(console.error).finally(() => prisma.$disconnect());
