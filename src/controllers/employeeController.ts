import { Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/authMiddleware';

export const getAllEmployees = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const employees = await prisma.legacyEmployee.findMany({
      where: companyId ? { company_id: String(companyId) } : {}
    });
    res.json(employees);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch employees', detail: error.message });
  }
};
