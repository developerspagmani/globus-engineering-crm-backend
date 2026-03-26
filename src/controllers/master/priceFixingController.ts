import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import crypto from 'crypto';

export const getPriceFixings = async (req: Request, res: Response) => {
  try {
    const companyId = (req.query.companyId || req.query.company_id) as string;
    const priceFixings = await (prisma as any).priceFixing.findMany({
      where: companyId ? { company_id: String(companyId) } : {},
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: priceFixings });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createPriceFixing = async (req: Request, res: Response) => {
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

    const priceFixing = await (prisma as any).priceFixing.create({
      data: {
        id: crypto.randomUUID(),
        customer_id: String(data.customerId),
        customer_name: data.customerName,
        item_id: String(data.itemId),
        item_name: data.itemName,
        process_id: String(data.processId),
        process_name: data.processName,
        price: parseFloat(data.price),
        company_id: finalCompanyId,
      },
    });
    res.json({ success: true, data: priceFixing });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePriceFixing = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const priceFixing = await (prisma as any).priceFixing.update({
      where: { id },
      data: {
        customer_id: data.customerId,
        customer_name: data.customerName,
        item_id: data.itemId,
        item_name: data.itemName,
        process_id: data.processId,
        process_name: data.processName,
        price: parseFloat(data.price),
      },
    });
    res.json({ success: true, data: priceFixing });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePriceFixing = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await (prisma as any).priceFixing.delete({ where: { id } });
    res.json({ success: true, message: 'Price Fixing deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
