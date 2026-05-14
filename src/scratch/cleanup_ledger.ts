import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const partyId = '10061';
  const rogueVchNo = 'VCH-227480';
  
  console.log(`Checking for rogue ledger entry ${rogueVchNo} for party ${partyId}...`);
  
  const entries = await (prisma as any).ledgerEntry.findMany({
    where: {
      party_id: partyId,
      vch_no: rogueVchNo
    }
  });
  
  console.log('Found entries:', JSON.stringify(entries, null, 2));
  
  if (entries.length > 0) {
    const deleted = await (prisma as any).ledgerEntry.deleteMany({
      where: {
        party_id: partyId,
        vch_no: rogueVchNo
      }
    });
    console.log(`Deleted ${deleted.count} rogue entries.`);
  } else {
    console.log('No rogue entries found.');
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
