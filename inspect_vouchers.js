const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const voucher = await prisma.voucher.findUnique({
      where: { id: '19f2708b-9ff3-4f28-bd09-66d387b7d518' }
    });
    console.log(JSON.stringify(voucher, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
