const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkVoucherDiscrepancy() {
  try {
    console.log("Searching for Voucher VCH-614807...");
    const voucher = await prisma.voucher.findFirst({
      where: { voucherNo: 'VCH-614807' },
      select: { id: true, voucherNo: true, amount: true, referenceNo: true, description: true }
    });

    if (!voucher) {
      console.log("Voucher not found.");
      return;
    }

    console.log("Voucher Data:", JSON.stringify(voucher, null, 2));
    
    if (voucher.referenceNo) {
      console.log("Reference No Content:", voucher.referenceNo);
      const items = voucher.referenceNo.split(',');
      console.log(`Attached Invoices count: ${items.length}`);
      items.forEach((item, i) => {
        console.log(`Item ${i+1}: ${item.trim()}`);
      });
    }

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkVoucherDiscrepancy();
