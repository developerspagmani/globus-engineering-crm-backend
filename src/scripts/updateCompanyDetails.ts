import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting company details update...');

  const newAddress = 'No 24,Annaiyappan Street,S.S.Nagar, Nallampalayam,Ganapathy Post, Coimbatore-641006.';

  const companies = await prisma.company.findMany();

  for (const company of companies) {
    console.log(`Updating company: ${company.name} (${company.id})`);

    let settings = {};
    try {
      settings = company.invoice_settings ? JSON.parse(company.invoice_settings as string) : {};
    } catch (e) {
      settings = {};
    }

    const newAddress = 'No 24,Annaiyappan Street,S.S.Nagar, Nallampalayam,Ganapathy Post, Coimbatore-641006.';
    const newName = 'GLOBUS ENGINEERING TOOLS';

    const updatedSettings = {
      ...settings,
      companyName: newName,
      companySubHeader: newAddress,
      companyAddress: newAddress,
    };

    await prisma.company.update({
      where: { id: company.id },
      data: {
        name: newName,
        company_sub_header: newAddress,
        company_address: newAddress,
        invoice_settings: JSON.stringify(updatedSettings),
      } as any,
    });
    console.log(`Updated company: ${company.id} to ${newName}`);
  }

  console.log('Update complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
