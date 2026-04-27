import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getAllLeads = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const where: any = companyId ? { company_id: String(companyId) } : {};
    
    // Security: Filter by area if user is Sales
    if (user?.role === 'sales' && user?.assigned_area) {
      where.assigned_area = user.assigned_area;
    }

    const leads = await prisma.lead.findMany({ where });
    res.json(leads);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch leads', detail: error.message });
  }
};

export const createLead = async (req: AuthRequest, res: Response) => {
  const { id, name, email, phone, company, industry, source, status, notes, assigned_area, product_interest, next_visit_date } = req.body;
  
  // Validation for mandatory fields
  if (!name) return res.status(400).json({ error: 'Lead name is mandatory' });
  if (!phone) return res.status(400).json({ error: 'Phone number is mandatory' });

  const user = req.user;

  try {
    const lead = await prisma.lead.create({
      data: {
        id: id || crypto.randomUUID(),
        name,
        email,
        phone,
        company,
        industry,
        source,
        status: status || 'new',
        agent_id: user?.id,
        company_id: user?.company_id,
        notes,
        assigned_area,
        product_interest,
        next_visit_date: next_visit_date ? new Date(next_visit_date) : null
      }
    });
    res.status(201).json(lead);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create lead', detail: error.message });
  }
};


export const updateLead = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { name, email, phone, company, industry, source, status, notes, assigned_area, product_interest, next_visit_date } = req.body;
  
  // Validation for mandatory fields if provided
  if (name !== undefined && !name) return res.status(400).json({ error: 'Lead name is mandatory' });
  if (phone !== undefined && !phone) return res.status(400).json({ error: 'Phone number is mandatory' });

  try {
    const lead = await prisma.lead.update({
      where: { id },
      data: { 
        name, 
        email, 
        phone, 
        company, 
        industry, 
        source, 
        status, 
        notes,
        assigned_area,
        product_interest,
        next_visit_date: next_visit_date ? new Date(next_visit_date) : null
      }
    });
    res.json(lead);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update lead', detail: error.message });
  }
};

export const deleteLead = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    await prisma.lead.delete({ where: { id } });
    res.json({ message: 'Lead deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete lead', detail: error.message });
  }
};
