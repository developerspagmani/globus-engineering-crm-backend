import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';

export const getAllChallans = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const challans = await prisma.challan.findMany({
      where: companyId ? { 
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() }
        ]
      } : {},
      orderBy: { created_at: 'desc' }
    });
    res.json(challans.map((c: any) => ({ ...c, items: JSON.parse(c.items_json || '[]') })));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch challans', detail: error.message });
  }
};

export const createChallan = async (req: AuthRequest, res: Response) => {
  const { id, challan_no, party_id, party_name, party_type, type, status, items, vehicle_no, driver_name, company_id } = req.body;
  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? (company_id || (req.body as any).companyId) : (user?.company_id || (user as any)?.companyId || company_id || (req.body as any).companyId);

  try {
    const challan = await prisma.challan.create({
      data: {
        id: id || undefined,
        challan_no,
        party_id,
        party_name,
        party_type,
        company_id: String(finalCompanyId || ''),
        date: new Date(),
        type,
        status: status || 'Pending',
        items_json: JSON.stringify(items || []),
        vehicle_no,
        driver_name
      }
    });

    res.status(201).json({ ...challan, items: JSON.parse(challan.items_json || '[]') });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create challan', detail: error.message });
  }
};

export const updateChallan = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { challan_no, party_id, party_name, party_type, type, status, items, vehicle_no, driver_name } = req.body;
  try {
    const challan = await prisma.challan.update({
      where: { id: String(id) },
      data: {
        challan_no,
        party_id,
        party_name,
        party_type,
        type,
        status,
        items_json: items ? JSON.stringify(items) : undefined,
        vehicle_no,
        driver_name
      }
    });
    res.json({ ...challan, items: JSON.parse(challan.items_json || '[]') });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update challan', detail: error.message });
  }
};

export const deleteChallan = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.challan.delete({ where: { id: String(id) } });
    res.json({ message: 'Challan deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete challan', detail: error.message });
  }
};
