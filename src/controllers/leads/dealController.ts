import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

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

export const createDeal = async (req: AuthRequest, res: Response) => {
  const { id, title, lead_id, value, status, priority, expected_closing_date, notes } = req.body;
  const user = req.user;

  try {
    const deal = await prisma.deal.create({
      data: {
        id: id || crypto.randomUUID(),
        title,
        lead_id,
        agent_id: user?.id,
        company_id: user?.company_id,
        value: value ? parseFloat(String(value)) : 0,
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


export const updateDeal = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { title, lead_id, value, status, priority, expected_closing_date, notes } = req.body;
  try {
    const deal = await prisma.deal.update({
      where: { id: String(id) },
      data: {
        title,
        lead_id,
        value: value ? parseFloat(value) : undefined,
        status,
        priority,
        expected_closing_date: expected_closing_date ? new Date(expected_closing_date) : undefined,
        notes
      }
    });
    res.json(deal);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update deal', detail: error.message });
  }
};

export const deleteDeal = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    await prisma.deal.delete({ where: { id: String(id) } });
    res.json({ message: 'Deal deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete deal', detail: error.message });
  }
};
