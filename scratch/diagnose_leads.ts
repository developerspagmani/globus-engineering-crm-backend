import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- DIAGNOSTIC: Checking Leads for Ramkumar ---');
  
  // Find Ramkumar user
  const ramkumar = await prisma.user.findFirst({
    where: { name: { contains: 'Ramkumar' } }
  });

  if (!ramkumar) {
    console.log('User Ramkumar not found!');
    return;
  }

  console.log('User found:', {
    id: ramkumar.id,
    name: ramkumar.name,
    role: ramkumar.role,
    company_id: ramkumar.company_id,
    assigned_area: ramkumar.assigned_area
  });

  // Find all leads for this company
  const companyLeads = await prisma.lead.findMany({
    where: { company_id: ramkumar.company_id }
  });

  console.log(`Total leads in company ${ramkumar.company_id}:`, companyLeads.length);

  // Check which leads match the filter
  const matchingLeads = companyLeads.filter(l => 
    l.agent_id === ramkumar.id || 
    (ramkumar.assigned_area && l.assigned_area === ramkumar.assigned_area)
  );

  console.log('Leads matching Ramkumar filter:', matchingLeads.length);
  
  if (matchingLeads.length > 0) {
    console.log('First matching lead:', {
      id: matchingLeads[0].id,
      name: matchingLeads[0].name,
      agent_id: matchingLeads[0].agent_id,
      assigned_area: matchingLeads[0].assigned_area
    });
  } else {
    console.log('No leads match the filter logic.');
    if (companyLeads.length > 0) {
        console.log('Sample lead from company (not matching):', {
            id: companyLeads[0].id,
            name: companyLeads[0].name,
            agent_id: companyLeads[0].agent_id,
            assigned_area: companyLeads[0].assigned_area
        });
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
