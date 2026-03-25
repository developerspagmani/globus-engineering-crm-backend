import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/authMiddleware';

const JWT_SECRET = process.env.JWT_SECRET || 'globus_crm_secret_key_2024';

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const { companyId } = req.body;
    // Search in app_users
    const users = await (prisma as any).User.findMany({
      where: { email }
    });
    const user = users[0];

    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify company context if not super admin
    if (user.role !== 'super_admin' && companyId && user.company_id !== companyId) {
        return res.status(403).json({ error: 'You are not authorized for this organization context' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        company_id: user.company_id,
        module_permissions: JSON.parse(user.module_permissions || '[]')
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    const company = user.company_id ? await prisma.company.findUnique({
      where: { id: user.company_id }
    }) : null;

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
        permissions: JSON.parse(user.permissions || '[]'),
        modulePermissions: JSON.parse(user.module_permissions || '[]')
      },
      company: company ? {
        id: company.id,
        name: company.name,
        slug: company.slug,
        activeModules: JSON.parse(company.active_modules || '[]')
      } : null
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Login failed', detail: error.message });
  }
};

export const getMe = async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const user = await (prisma as any).User.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.company_id,
      permissions: JSON.parse(user.permissions || '[]'),
      modulePermissions: JSON.parse(user.module_permissions || '[]')
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch user', detail: error.message });
  }
};

export const register = async (req: Request, res: Response) => {
  const { id, name, email, password, role, company_id } = req.body;
  console.log('--- USER REGISTRATION ATTEMPT ---');
  console.log('Payload:', JSON.stringify(req.body, null, 2));

  try {
    const user = await (prisma as any).User.create({
      data: {
        id: id || crypto.randomUUID(),
        name,
        email,
        password: password || 'password123',
        role,
        company_id: company_id || null,
        permissions: JSON.stringify(['all']),
        module_permissions: JSON.stringify(req.body.modulePermissions || [
          { moduleId: 'all', canRead: true, canCreate: true, canEdit: true, canDelete: true }
        ])
      }
    });

    console.log('User created successfully in DB:', user.email);
    res.status(201).json({ message: 'User registered successfully', user });
  } catch (error: any) {
    console.error('--- REGISTRATION ERROR ---');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Registration failed', detail: error.message });
  }
};
