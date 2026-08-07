import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting DC number fix script...');
  
  // Get all companies to run this per company
  const companies = await prisma.company.findMany();
  
  for (const company of companies) {
    console.log(`\nProcessing company: ${company.name} (${company.id})`);
    
    // Find highest valid delivery_no (less than 9000)
    const lastValidDC = await (prisma as any).legacyInvoice.findFirst({
      where: {
        company_id: company.id,
        delivery_no: { not: null, lt: 9000 }
      },
      orderBy: { delivery_no: 'desc' },
      select: { delivery_no: true }
    });
    
    let currentNextDC = lastValidDC?.delivery_no || 4000;
    console.log(`Last valid DC for ${company.name} is ${currentNextDC}`);
    
    // Find all outliers (9000 series and above)
    const outliers = await (prisma as any).legacyInvoice.findMany({
      where: {
        company_id: company.id,
        delivery_no: { gte: 9000 }
      },
      orderBy: { id: 'asc' } // chronological order
    });
    
    console.log(`Found ${outliers.length} outliers in 9000+ series.`);
    
    for (const outlier of outliers) {
      currentNextDC++;
      console.log(`Updating legacyInvoice ${outlier.id}: Delivery No ${outlier.delivery_no} -> ${currentNextDC}`);
      
      await (prisma as any).legacyInvoice.update({
        where: { id: outlier.id },
        data: { delivery_no: currentNextDC }
      });
      
      // Also update the challan record if one exists
      // In challan table, challan_no is stored as "DC-9220"
      const challans = await prisma.challan.findMany({
        where: { challan_no: `DC-${outlier.delivery_no}`, company_id: company.id }
      });
      
      for (const challan of challans) {
        console.log(`Updating challan ${challan.id}: ${challan.challan_no} -> DC-${currentNextDC}`);
        await prisma.challan.update({
          where: { id: challan.id },
          data: { challan_no: `DC-${currentNextDC}` }
        });
      }
    }
  }
  
  console.log('\nFinished updating DC numbers.');
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
