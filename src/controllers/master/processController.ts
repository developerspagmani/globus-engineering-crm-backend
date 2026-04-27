import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import crypto from 'crypto';

export const getProcesses = async (req: Request, res: Response) => {
  try {
    const companyId = (req.query.companyId || req.query.company_id) as string;
    const processes = await (prisma as any).process.findMany({
      where: companyId ? { company_id: String(companyId) } : {},
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: processes });
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
