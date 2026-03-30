import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../../config/prisma';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'globus_crm_secret_key_2024';

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        company: true
      }
    });

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    let isMatch = false;
    try {
      // Check if it is a bcrypt hash
      if (user.password.startsWith('$2')) {
        isMatch = await bcrypt.compare(password, user.password);
      } else {
        // Fallback for plain text legacy passwords
        isMatch = user.password === password;
      }
    } catch (e) {
      isMatch = user.password === password;
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { 
        id: user.id, 
        name: user.name,
        email: user.email, 
        role: user.role, 
        company_id: user.company_id,
        module_permissions: user.module_permissions ? JSON.parse(user.module_permissions) : []
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { ...user, password: '' } });
  } catch (error: any) {
    res.status(500).json({ error: 'Login failed', detail: error.message });
  }
};

export const register = async (req: Request, res: Response) => {
  const { name, email, password, role, company_id } = req.body;
  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        name,
        email,
        password: hashedPassword,
        role,
        company_id
      }
    });

    res.status(201).json({ user: { ...user, password: '' } });
  } catch (error: any) {
    res.status(500).json({ error: 'Registration failed', detail: error.message });
  }
};

export const getMe = async (req: any, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { company: true }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch user', detail: error.message });
  }
};
