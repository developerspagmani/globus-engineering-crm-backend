import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import crypto from 'crypto';

export const getItems = async (req: Request, res: Response) => {
  try {
    const companyId = (req.query.companyId || req.query.company_id) as string;
    const items = await (prisma as any).item.findMany({
      where: companyId ? { company_id: String(companyId) } : {},
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: items });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createItem = async (req: Request, res: Response) => {
  try {
    const data = req.body;
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

    const item = await (prisma as any).item.create({
      data: {
        id: crypto.randomUUID(),
        item_code: data.itemCode,
        item_name: data.itemName,
        company_id: finalCompanyId,
      },
    });
    res.json({ success: true, data: item });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const item = await (prisma as any).item.update({
      where: { id },
      data: {
        item_code: data.itemCode,
        item_name: data.itemName,
      },
    });
    res.json({ success: true, data: item });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await (prisma as any).item.delete({ where: { id } });
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
