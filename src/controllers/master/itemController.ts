import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import crypto from 'crypto';

export const getItems = async (req: Request, res: Response) => {
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
          { item_name: { contains: search } },
          { item_code: { contains: search } }
        ]
      });
    }

    const [items, totalCount] = await Promise.all([
      (prisma as any).item.findMany({
        where,
        skip,
        take: limit,
        orderBy: sortBy ? { [sortBy]: sortOrder } : { created_at: 'desc' },
      }),
      (prisma as any).item.count({ where })
    ]);

    res.json({
      success: true,
      data: items,
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

export const createItem = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    
    // Validation for mandatory fields removed as per request
    // if (!data.itemName || !data.itemCode) {
    //   return res.status(400).json({ success: false, message: 'Item name and code are mandatory' });
    // }

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
        item_code: data.itemCode || '',
        item_name: data.itemName || '',
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
    
    // Validation for mandatory fields if provided removed as per request
    // if (data.itemName !== undefined && !data.itemName) return res.status(400).json({ success: false, message: 'Item name is mandatory' });
    // if (data.itemCode !== undefined && !data.itemCode) return res.status(400).json({ success: false, message: 'Item code is mandatory' });

    const item = await (prisma as any).item.update({
      where: { id },
      data: {
        item_code: data.itemCode !== undefined ? data.itemCode : undefined,
        item_name: data.itemName !== undefined ? data.itemName : undefined,
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
