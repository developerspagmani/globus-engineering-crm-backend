import { Request, Response } from 'express';
import prisma from '../config/prisma';
import crypto from 'crypto';

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await (prisma as any).User.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        company_id: true,
        permissions: true,
        module_permissions: true
      }
    });
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch users', detail: error.message });
  }
};

export const createUser = async (req: Request, res: Response) => {
  const { id, name, email, password, role, company_id, permissions, modulePermissions } = req.body;

  try {
    const user = await (prisma as any).User.create({
      data: {
        id: id || crypto.randomUUID(),
        name,
        email,
        password: password || 'password123',
        role,
        company_id,
        permissions: permissions ? JSON.stringify(permissions) : JSON.stringify(['all']),
        module_permissions: modulePermissions ? JSON.stringify(modulePermissions) : JSON.stringify([{ moduleId: 'all', canRead: true, canCreate: true, canEdit: true, canDelete: true }])
      }
    });

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        company_id: user.company_id,
        module_permissions: user.module_permissions
      }
    });
  } catch (error: any) {
    console.error('USER CONTROLLER ERROR:', error);
    res.status(500).json({ error: 'Failed to create user', detail: error.message });
  }
};

export const updateUserPermissions = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { modulePermissions } = req.body;

  try {
    const user = await (prisma as any).User.update({
      where: { id },
      data: {
        module_permissions: JSON.stringify(modulePermissions)
      }
    });

    res.json({
      message: 'Permissions updated',
      user: {
        id: user.id,
        module_permissions: JSON.parse(user.module_permissions || '[]')
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Update failed', detail: error.message });
  }
};
