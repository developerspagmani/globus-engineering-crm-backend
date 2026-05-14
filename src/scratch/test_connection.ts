
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  console.log('Attempting to connect to database...');
  try {
    await prisma.$connect();
    console.log('✅ Connection successful!');
    const count = await prisma.inwardEntry.count();
    console.log(`Database reachable. Total inward entries: ${count}`);
  } catch (error: any) {
    console.error('❌ Connection failed!');
    console.error('Error Code:', error.code);
    console.error('Error Message:', error.message);
    if (error.message.includes('3306')) {
      console.log('\nPossible causes:');
      console.log('1. Your current IP is not whitelisted in Hostinger Remote MySQL.');
      console.log('2. The MySQL server at Hostinger is currently down or under maintenance.');
      console.log('3. Your local network/firewall is blocking outbound connections on port 3306.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
