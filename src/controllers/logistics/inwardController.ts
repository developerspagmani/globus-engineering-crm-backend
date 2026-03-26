import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getInwardEntries = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const entries = await prisma.inwardEntry.findMany({
      where: companyId ? { company_id: String(companyId) } : {}
    });
    
    const parsedEntries = entries.map((e: any) => ({
      ...e,
      items: JSON.parse(e.items_json || '[]')
    }));
    
    res.json(parsedEntries);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch inward entries', detail: error.message });
  }
};

export const createInwardEntry = async (req: AuthRequest, res: Response) => {
  const { 
    inward_no, customer_id, customer_name, address, vendor_id, vendor_name, 
    po_reference, po_date, challan_no, dc_no, dc_date, vehicle_no, status, items, company_id, companyId 
  } = req.body;
  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? (company_id || companyId) : (user?.company_id || company_id || companyId);

  try {
    const entry = await prisma.inwardEntry.create({
      data: {
        id: crypto.randomUUID(),
        inward_no,
        customer_id: String(customer_id || ''),
        customer_name,
        address,
        vendor_id: String(vendor_id || ''),
        vendor_name: String(vendor_name || ''),
        po_reference: String(po_reference || ''),
        po_date: po_date ? new Date(po_date) : null,
        challan_no: String(challan_no || ''),
        dc_no: String(dc_no || ''),
        dc_date: dc_date ? new Date(dc_date) : null,
        vehicle_no: String(vehicle_no || ''),
        company_id: String(finalCompanyId || ''),
        status: status || 'pending',
        items_json: JSON.stringify(items || []),
        date: new Date()
      }
    });

    res.status(201).json({
      ...entry,
      items: JSON.parse((entry as any).items_json || '[]')
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create inward entry', detail: error.message });
  }
};

export const updateInwardEntry = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { 
    inward_no, customer_id, customer_name, address, vendor_id, vendor_name, 
    po_reference, po_date, challan_no, dc_no, dc_date, vehicle_no, status, items 
  } = req.body;

  try {
    const entry = await prisma.inwardEntry.update({
      where: { id: String(id) },
      data: {
        inward_no,
        customer_id,
        customer_name,
        address,
        vendor_id,
        vendor_name,
        po_reference,
        po_date: po_date ? new Date(po_date) : undefined,
        challan_no,
        dc_no,
        dc_date: dc_date ? new Date(dc_date) : undefined,
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
    res.status(500).json({ error: 'Failed to update inward entry', detail: error.message });
  }
};

export const deleteInwardEntry = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.inwardEntry.delete({ where: { id: String(id) } });
    res.json({ message: 'Inward entry deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete inward entry', detail: error.message });
  }
};
