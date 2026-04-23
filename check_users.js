
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: { company: true }
  });
  console.log('USERS IN DATABASE:');
  users.forEach(u => {
    console.log(`- ID: ${u.id}, Name: ${u.name}, Email: ${u.email}, Password: ${u.password}, Role: ${u.role}, Company: ${u.company?.name || 'None'}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
