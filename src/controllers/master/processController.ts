import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import crypto from 'crypto';

export const getProcesses = async (req: Request, res: Response) => {
  const queryCompanyId = (req.query.companyId || req.query.company_id) as string;

  // Pagination & Filter Params
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const search = (req.query.search as string || '').toLowerCase();
  const sortBy = req.query.sortBy as string;
  const sortOrder = (req.query.sortOrder as string) === 'desc' ? 'desc' : 'asc';

  try {
    const where: any = {
      AND: []
    };

    if (queryCompanyId) {
      where.AND.push({
        OR: [
          { company_id: String(queryCompanyId) },
          { company_id: String(queryCompanyId).toLowerCase() },
          { company_id: String(queryCompanyId).toUpperCase() }
        ]
      });
    }

    if (search) {
      where.AND.push({
        OR: [
          { process_name: { contains: search } }
        ]
      });
    }

    const [processes, totalCount] = await Promise.all([
      (prisma as any).process.findMany({
        where,
        skip,
        take: limit,
        orderBy: sortBy ? { [sortBy]: sortOrder } : { created_at: 'desc' },
      }),
      (prisma as any).process.count({ where })
    ]);

    res.json({
      success: true,
      data: processes,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createProcess = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    
    // Validation for mandatory fields
    if (!data.processName) {
      return res.status(400).json({ success: false, message: 'Process name is mandatory' });
    }

    const user: any = (req as any).user;
    
    const userCompanyId = user?.company_id || user?.companyId;
    const incomingCompanyId = data.companyId || data.company_id;
    
    let finalCompanyId = userCompanyId;
    if (user?.role === 'super_admin' || user?.role === 'company_admin') {
        finalCompanyId = incomingCompanyId || userCompanyId;
    }
    if (!finalCompanyId && incomingCompanyId) {
        finalCompanyId = incomingCompanyId;
    }

    const process = await (prisma as any).process.create({
      data: {
        id: crypto.randomUUID(),
        process_name: data.processName,
        company_id: finalCompanyId,
      },
    });
    res.json({ success: true, data: process });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateProcess = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    
    // Validation for mandatory fields if provided
    if (data.processName !== undefined && !data.processName) return res.status(400).json({ success: false, message: 'Process name is mandatory' });

    const process = await (prisma as any).process.update({
      where: { id },
      data: {
        process_name: data.processName,
      },
    });
    res.json({ success: true, data: process });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteProcess = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await (prisma as any).process.delete({ where: { id } });
    res.json({ success: true, message: 'Process deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
