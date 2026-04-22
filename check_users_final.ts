import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
p.user.findMany({ include: { company: true } }).then(users => {
  users.forEach(u => {
    console.log(`USER: ${u.email} | ROLE: ${u.role} | COMPANY_ID: ${u.company_id} | COMPANY_NAME: ${u.company?.name || 'NOT LINKED'}`);
  });
}).finally(() => p.$disconnect());
