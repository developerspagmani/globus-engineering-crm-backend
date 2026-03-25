import { Request, Response } from 'express';
import prisma from '../config/prisma';
import crypto from 'crypto';

// --- Items ---
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
    // Handle super admin context
    const user: any = (req as any).user;
    console.log('--- MASTER DATA CREATION ---');
    console.log('User from Token:', user);
    console.log('Base Payload:', data);
    
    // Support both snake_case and camelCase for companyId
    const userCompanyId = user?.company_id || user?.companyId;
    const incomingCompanyId = data.companyId || data.company_id;
    
    // For now, if role is company_admin or super_admin, we can trust the incoming ID if it matches their scope
    let finalCompanyId = userCompanyId;
    
    if (user?.role === 'super_admin' || user?.role === 'company_admin') {
        finalCompanyId = incomingCompanyId || userCompanyId;
    }
    
    // Safety fallback: If somehow both are missing but it's clearly a Company Admin action, use incoming
    if (!finalCompanyId && incomingCompanyId) {
        console.log('SAFETY FALLBACK: Using incomingCompanyId because user context was empty');
        finalCompanyId = incomingCompanyId;
    }
    
    console.log('Final Database Write ID:', finalCompanyId);

    const item = await (prisma as any).item.create({
      data: {
        id: crypto.randomUUID(),
        item_code: data.itemCode,
        item_name: data.itemName,
        company_id: finalCompanyId,
      },
    });
    console.log('Successfully saved item with company_id:', item.company_id);
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

// --- Processes ---
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

// --- Price Fixing ---
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
