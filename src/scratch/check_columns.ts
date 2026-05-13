import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkColumns() {
  try {
    const result = await prisma.$queryRaw`DESCRIBE app_challans`;
    console.log('Columns in app_challans:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Failed to describe table:', err);
  } finally {
    await prisma.$disconnect();
  }
}

checkColumns();
