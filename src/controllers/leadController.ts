import { Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/authMiddleware';

export const getAllLeads = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;

  // Enforce company isolation: non-super_admins only see their own company
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

export const getAllDeals = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const deals = await prisma.deal.findMany({
      where: companyId ? { company_id: String(companyId) } : {}
    });
    res.json(deals);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch deals', detail: error.message });
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

export const createDeal = async (req: AuthRequest, res: Response) => {
  const { id, title, lead_id, value, status, priority, expected_closing_date, notes } = req.body;
  const user = req.user;

  try {
    const deal = await prisma.deal.create({
      data: {
        id,
        title,
        lead_id,
        agent_id: user?.id,
        company_id: user?.company_id,
        value: parseFloat(value),
        status: status || 'open',
        priority: priority || 'medium',
        expected_closing_date: expected_closing_date ? new Date(expected_closing_date) : null,
        notes
      }
    });

    res.status(201).json(deal);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create deal', detail: error.message });
  }
};
