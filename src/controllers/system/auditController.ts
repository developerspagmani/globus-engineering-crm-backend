import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';

/**
 * Fetches audit logs for the company
 */
export const getAuditLogs = async (req: AuthRequest, res: Response) => {
  const companyId = req.user?.company_id;
  
  if (!companyId) {
    return res.status(400).json({ error: 'Company context required.' });
  }

  try {
    const logs = await (prisma as any).auditLog.findMany({
      where: { company_id: companyId },
      orderBy: { created_at: 'desc' },
      take: 100 // Last 100 logs
    });

    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch audit logs', detail: error.message });
  }
};
