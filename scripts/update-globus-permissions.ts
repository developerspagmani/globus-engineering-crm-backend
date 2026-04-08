import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const email = 'admin@globus.com';
  console.log(`Updating permissions for ${email}...`);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error('User not found!');
    return;
  }

  // Parse existing or start with empty
  let permissions = [];
  try {
    permissions = JSON.parse(user.module_permissions || '[]');
  } catch (e) {
    permissions = [];
  }

  // Add mod_vendor if not already there, or update it
  const vendorPermId = 'mod_vendor';
  const index = permissions.findIndex((p: any) => p.moduleId === vendorPermId);
  const fullPerms = {
    moduleId: vendorPermId,
    canRead: true,
    canCreate: true,
    canEdit: true,
    canDelete: true
  };

  if (index >= 0) {
    permissions[index] = fullPerms;
  } else {
    permissions.push(fullPerms);
  }

  // Save back to DB
  await prisma.user.update({
    where: { email },
    data: {
      module_permissions: JSON.stringify(permissions)
    }
  });

  console.log('✅ Permissions updated successfully for Vendor module!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
