import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export const getAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      include: { company: true }
    });
    // Remove sensitive data and map to frontend snakeCase -> camelCase
    const formattedUsers = users.map(u => ({
      ...u,
      password: '',
      permissions: (u as any).permissions ? JSON.parse((u as any).permissions) : [],
      assignedArea: (u as any).assigned_area,
      modulePermissions: (u as any).module_permissions ? JSON.parse((u as any).module_permissions) : []
    }));
    res.json(formattedUsers);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch users', detail: error.message });
  }
};

export const createUser = async (req: AuthRequest, res: Response) => {
  const { name, email, password, role, company_id, assigned_area, permissions, module_permissions, modulePermissions } = req.body;
  const modulePermsToSave = modulePermissions || module_permissions;
  const legacyPermsToSave = permissions || [];
  
  console.log('BACKEND: createUser request data:', { name, email, role, assigned_area, permissionsCount: modulePermsToSave?.length });

  try {
    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        name,
        email,
        password,
        role,
        company_id: company_id || 'comp_globus',
        assigned_area,
        permissions: JSON.stringify(legacyPermsToSave),
        module_permissions: JSON.stringify(modulePermsToSave || [])
      }
    });
    console.log('BACKEND: User created successfully:', user.id);
    res.status(201).json({ 
      user: { 
        ...user, 
        password: '',
        permissions: (user as any).permissions ? JSON.parse((user as any).permissions) : [],
        assignedArea: (user as any).assigned_area,
        modulePermissions: (user as any).module_permissions ? JSON.parse((user as any).module_permissions) : []
      }
    });
  } catch (error: any) {
    console.error('BACKEND: Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user', detail: error.message });
  }
};

export const updateUserPermissions = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { module_permissions } = req.body;
  try {
    const user = await prisma.user.update({
      where: { id: String(id) },
      data: {
        module_permissions: JSON.stringify(module_permissions || [])
      }
    });
    res.json({ ...user, password: '' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update permissions', detail: error.message });
  }
};

export const updateUser = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, email, phone, role, company_id, assigned_area, permissions, module_permissions, modulePermissions } = req.body;
  const modulePermsToSave = modulePermissions || module_permissions;
  const legacyPermsToSave = permissions || [];
  
  console.log('BACKEND: updateUser request data for ID:', id, { name, email, role, permissionsCount: modulePermsToSave?.length });

  try {
    const dataToUpdate: any = {
      name,
      email,
      phone,
      role,
      company_id,
      assigned_area
    };
    if (legacyPermsToSave && legacyPermsToSave.length > 0) {
      dataToUpdate.permissions = JSON.stringify(legacyPermsToSave);
    }
    if (modulePermsToSave) {
      dataToUpdate.module_permissions = JSON.stringify(modulePermsToSave);
    }
    const user = await prisma.user.update({
      where: { id: String(id) },
      data: dataToUpdate
    });
    res.json({ 
      user: { 
        ...user, 
        password: '',
        permissions: (user as any).permissions ? JSON.parse((user as any).permissions) : [],
        assignedArea: (user as any).assigned_area,
        modulePermissions: (user as any).module_permissions ? JSON.parse((user as any).module_permissions) : []
      } 
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update user', detail: error.message });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.user.delete({
      where: { id: String(id) }
    });
    res.json({ message: 'User deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete user', detail: error.message });
  }
};

export const resetPassword = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'New password is required' });
  }

  try {
    const user = await prisma.user.update({
      where: { id: String(id) },
      data: {
        password: password
      }
    });

    res.json({ message: 'Password updated successfully', user: { ...user, password: '' } });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to reset password', detail: error.message });
  }
};
