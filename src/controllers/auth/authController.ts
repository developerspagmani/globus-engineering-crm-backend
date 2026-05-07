import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../../config/prisma';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'globus_crm_secret_key_2024';

const mapCompany = (company: any) => {
  if (!company) return null;
  
  let parsedSettings = {};
  try {
    parsedSettings = company.invoice_settings ? JSON.parse(company.invoice_settings) : {};
    if (!parsedSettings || typeof parsedSettings !== 'object') {
        parsedSettings = {};
    }
  } catch (e) {
    console.error(`Failed to parse invoice_settings for company ${company.id}`, e);
    parsedSettings = {};
  }

  return {
    ...company,
    activeModules: (() => {
        try {
            return company.active_modules ? JSON.parse(company.active_modules) : [];
        } catch (e) {
            console.error(`Failed to parse active_modules for company ${company.id}`, e);
            return [];
        }
    })(),
    logo: company.logo,
    logoSecondary: company.logo_secondary,
    invoiceSettings: {
      ...parsedSettings,
      companyName: company.company_name || (parsedSettings as any).companyName,
      companySubHeader: company.company_sub_header || (parsedSettings as any).companySubHeader,
      companyAddress: company.company_address || (parsedSettings as any).companyAddress,
      gstNo: company.gst_no || (parsedSettings as any).gstNo,
      stateDetails: company.state_details || (parsedSettings as any).stateDetails,
      vatTin: company.vat_tin || (parsedSettings as any).vatTin,
      cstNo: company.cst_no || (parsedSettings as any).cstNo,
      panNo: company.pan_no || (parsedSettings as any).panNo,
      bankName: company.bank_name || (parsedSettings as any).bankName,
      bankAcc: company.bank_acc || (parsedSettings as any).bankAcc,
      bankBranchIfsc: company.bank_branch_ifsc || (parsedSettings as any).bankBranchIfsc,
      declarationText: company.declaration_text || (parsedSettings as any).declarationText,
    }
  };
};


export const login = async (req: Request, res: Response) => {
  const { email, password, company_id } = req.body;
  try {
    // Determine the target company filter from the dropdown
    const targetCompanyId = company_id === 'super_admin' ? null : company_id;

    const user = await prisma.user.findFirst({
      where: { 
        email,
        company_id: targetCompanyId // Explicitly checking the company link in the query
      },
      include: {
        company: true
      }
    });

    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid Email or Password.' });
    }

    let isMatch = false;
    try {
      if (user.password.startsWith('$2')) {
        isMatch = await bcrypt.compare(password, user.password);
      } else {
        isMatch = user.password === password;
      }
    } catch (e) {
      isMatch = user.password === password;
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign(
      { 
        id: user.id, 
        name: user.name,
        email: user.email, 
        role: user.role, 
        company_id: user.company_id,
        assigned_area: (user as any).assigned_area,
        module_permissions: (() => {
          try {
            return (user.module_permissions && user.module_permissions.trim()) ? JSON.parse(user.module_permissions) : [];
          } catch (e) {
            console.error(`Failed to parse module_permissions for user ${user.id}`, e);
            return [];
          }
        })()

      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      token, 
      user: { 
        ...user, 
        password: '',
        company_id: user.company_id,
        assignedArea: (user as any).assigned_area,
        modulePermissions: (() => {
          try {
            return (user.module_permissions && user.module_permissions.trim()) ? JSON.parse(user.module_permissions) : [];
          } catch (e) {
            console.error(`Failed to parse module_permissions for user ${user.id}`, e);
            return [];
          }
        })()

      },
      company: mapCompany(user.company)
    });
  } catch (error: any) {
    console.error('[LOGIN_ERROR]', error);
    res.status(500).json({ error: 'Login failed', detail: error.message });
  }
};

export const register = async (req: Request, res: Response) => {
    const { name, email, password, role, company_id, assigned_area } = req.body;
    try {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ error: 'User already exists' });
      }

      const user = await prisma.user.create({
        data: {
          id: crypto.randomUUID(),
          name,
          email,
          password,
          role,
          company_id,
          assigned_area
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
    
    res.json({
      ...user,
      password: '',
      company: mapCompany(user.company)
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch user', detail: error.message });
  }
};

export const resetPasswordDirect = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword }
    });

    res.json({ message: 'Password reset successful' });
  } catch (error: any) {
    res.status(500).json({ error: 'Password reset failed', detail: error.message });
  }
};

