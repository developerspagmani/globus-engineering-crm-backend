import { Request, Response } from 'express';
import prisma from '../config/prisma';
import crypto from 'crypto';

export const getAllCompanies = async (req: Request, res: Response) => {
  try {
    const companies = await prisma.company.findMany();
    // Map backend snake_case to frontend camelCase
    const mapped = companies.map(c => ({
      ...c,
      activeModules: c.active_modules ? JSON.parse(c.active_modules) : []
    }));
    res.json(mapped);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch companies', detail: error.message });
  }
};

export const createCompany = async (req: Request, res: Response) => {
  const { name, slug, plan, activeModules } = req.body;
  try {
    const company = await prisma.company.create({
      data: {
        id: crypto.randomUUID(),
        name,
        slug,
        plan,
        active_modules: JSON.stringify(activeModules || [])
      }
    });
    res.status(201).json({ 
        ...company, 
        activeModules: activeModules || []
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create company', detail: error.message });
  }
};

export const updateCompany = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, slug, plan, activeModules } = req.body;
  try {
    const company = await prisma.company.update({
      where: { id: String(id) },
      data: {
        name,
        slug,
        plan,
        active_modules: JSON.stringify(activeModules || [])
      }
    });
    res.json({
        ...company,
        activeModules: activeModules || []
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
