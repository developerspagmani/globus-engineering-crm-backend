import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import crypto from 'crypto';

export const getCompanyById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const company = await prisma.company.findUnique({
      where: { id: String(id) }
    });
    
    if (!company) return res.status(404).json({ error: 'Company not found' });

    res.json({
      ...company,
      activeModules: company.active_modules ? JSON.parse(company.active_modules) : [],
      logo: company.logo,
      logoSecondary: company.logo_secondary,
      invoiceSettings: company.invoice_settings ? JSON.parse(company.invoice_settings) : null
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch company', detail: error.message });
  }
};

export const getAllCompanies = async (req: Request, res: Response) => {
  try {
    const companies = await prisma.company.findMany();
    // Map backend snake_case to frontend camelCase
    const mapped = companies.map(c => ({
      ...c,
      activeModules: c.active_modules ? JSON.parse(c.active_modules) : [],
      logo: c.logo,
      logoSecondary: c.logo_secondary,
      invoiceSettings: c.invoice_settings ? JSON.parse(c.invoice_settings) : null
    }));
    res.json(mapped);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch companies', detail: error.message });
  }
};

export const createCompany = async (req: Request, res: Response) => {
  const { name, slug, plan, activeModules, logo, logoSecondary, invoiceSettings } = req.body;
  try {
    const company = await prisma.company.create({
      data: {
        id: crypto.randomUUID(),
        name,
        slug,
        plan,
        active_modules: JSON.stringify(activeModules || []),
        logo: logo || null,
        logo_secondary: logoSecondary || null,
        invoice_settings: JSON.stringify(invoiceSettings || null)
      } as any
    });
    res.status(201).json({ 
        ...company, 
        activeModules: activeModules || [],
        invoiceSettings: invoiceSettings || null
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create company', detail: error.message });
  }
};

export const updateCompany = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, slug, plan, activeModules, logo, logoSecondary, invoiceSettings } = req.body;
  
  try {
    const updateData: any = {};
    
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (plan !== undefined) updateData.plan = plan;
    if (activeModules !== undefined) updateData.active_modules = JSON.stringify(activeModules);
    
    // Support both camelCase and snake_case for logos from frontend
    if (logo !== undefined) updateData.logo = logo;
    if (logoSecondary !== undefined) updateData.logo_secondary = logoSecondary;
    
    if (invoiceSettings !== undefined) {
      updateData.invoice_settings = JSON.stringify(invoiceSettings);
    }

    const company = await prisma.company.update({
      where: { id: String(id) },
      data: updateData
    });

    res.json({
        ...company,
        activeModules: company.active_modules ? JSON.parse(company.active_modules) : [],
        logoSecondary: company.logo_secondary,
        invoiceSettings: company.invoice_settings ? JSON.parse(company.invoice_settings) : null
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update company', detail: error.message });
  }
};

export const deleteCompany = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.company.delete({ where: { id: String(id) } });
    res.json({ message: 'Company deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete company', detail: error.message });
  }
};
