import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const columns = await prisma.$queryRawUnsafe(`DESCRIBE app_challans`);
    console.log('Columns in app_challans:', JSON.stringify(columns, null, 2));
  } catch (err) {
    console.error('Error describing table:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
