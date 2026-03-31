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
    // Remove sensitive data
    res.json(users.map(u => ({ ...u, password: '' })));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch users', detail: error.message });
  }
};

export const createUser = async (req: AuthRequest, res: Response) => {
  const { name, email, password, role, company_id, module_permissions } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        name,
        email,
        password: hashedPassword,
        role,
        company_id,
        module_permissions: JSON.stringify(module_permissions || [])
      }
    });
    res.status(201).json({ ...user, password: '' });
  } catch (error: any) {
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
        module_permissions: JSON.stringify(module_permissions)
      }
    });
    res.json({ ...user, password: '' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update permissions', detail: error.message });
  }
};

export const updateUser = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, email, role, company_id, module_permissions } = req.body;
  try {
    const dataToUpdate: any = {
      name,
      email,
      role,
      company_id
    };
    if (module_permissions) {
      dataToUpdate.module_permissions = JSON.stringify(module_permissions);
    }
    const user = await prisma.user.update({
      where: { id: String(id) },
      data: dataToUpdate
    });
    res.json({ user: { ...user, password: '' } });
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
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.update({
      where: { id: String(id) },
      data: {
        password: hashedPassword
      }
    });

    res.json({ message: 'Password updated successfully', user: { ...user, password: '' } });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to reset password', detail: error.message });
  }
};
