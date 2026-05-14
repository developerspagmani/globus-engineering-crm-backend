import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const vouchers = await prisma.voucher.findMany({
    where: {
      OR: [
        { voucher_no: 'VCH-567996' },
        { voucher_no: 'VCH-531083' },
        { voucher_no: 'VCH-272460' }
      ]
    },
    select: {
      id: true,
      voucher_no: true,
      inward_id: true,
      inward_no: true,
      party_id: true,
      amount: true,
      others_amount: true,
      tds_amount: true
    }
  });

  console.log(JSON.stringify(vouchers, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
