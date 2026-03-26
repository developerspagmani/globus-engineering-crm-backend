import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';

export const getAllLeads = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const leads = await prisma.lead.findMany({
      where: companyId ? { company_id: String(companyId) } : {}
    });
    res.json(leads);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch leads', detail: error.message });
  }
};

export const createLead = async (req: AuthRequest, res: Response) => {
  const { id, name, email, phone, company, industry, source, status, notes } = req.body;
  const user = req.user;

  try {
    const lead = await prisma.lead.create({
      data: {
        id,
        name,
        email,
        phone,
        company,
        industry,
        source,
        status: status || 'new',
        agent_id: user?.id,
        company_id: user?.company_id,
        notes
      }
    });
    res.status(201).json(lead);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create lead', detail: error.message });
  }
};

export const updateLead = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { name, email, phone, company, industry, source, status, notes } = req.body;
  try {
    const lead = await prisma.lead.update({
      where: { id },
      data: { name, email, phone, company, industry, source, status, notes }
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
