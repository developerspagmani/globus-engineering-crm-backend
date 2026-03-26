import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getOutwardEntries = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const entries = await prisma.outwardEntry.findMany({
      where: companyId ? { company_id: String(companyId) } : {}
    });
    
    const parsedEntries = entries.map((e: any) => ({
      ...e,
      items: JSON.parse(e.items_json || '[]')
    }));
    
    res.json(parsedEntries);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch outward entries', detail: error.message });
  }
};

export const createOutwardEntry = async (req: AuthRequest, res: Response) => {
  const { 
    outward_no, customer_id, customer_name, invoice_reference, challan_no, vehicle_no, status, items, company_id 
  } = req.body;
  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? company_id : user?.company_id;

  try {
    const entry = await prisma.outwardEntry.create({
      data: {
        id: crypto.randomUUID(),
        outward_no,
        customer_id,
        customer_name,
        invoice_reference: String(invoice_reference || ''),
        challan_no: String(challan_no || ''),
        vehicle_no: String(vehicle_no || ''),
        company_id: finalCompanyId,
        status: status || 'dispatched',
        items_json: JSON.stringify(items || []),
        date: new Date()
      }
    });

    res.status(201).json({
      ...entry,
      items: JSON.parse((entry as any).items_json || '[]')
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create outward entry', detail: error.message });
  }
};

export const updateOutwardEntry = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { 
    outward_no, customer_id, customer_name, invoice_reference, challan_no, vehicle_no, status, items 
  } = req.body;

  try {
    const entry = await prisma.outwardEntry.update({
      where: { id: String(id) },
      data: {
        outward_no,
        customer_id,
        customer_name,
        invoice_reference,
        challan_no,
        vehicle_no,
        status,
        items_json: items ? JSON.stringify(items) : undefined,
      }
    });

    res.json({
      ...entry,
      items: JSON.parse((entry as any).items_json || '[]')
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update outward entry', detail: error.message });
  }
};

export const deleteOutwardEntry = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.outwardEntry.delete({ where: { id: String(id) } });
    res.json({ message: 'Outward entry deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete outward entry', detail: error.message });
  }
};
