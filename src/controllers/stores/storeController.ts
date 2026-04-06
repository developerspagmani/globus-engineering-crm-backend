import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

/**
 * STORE MANAGEMENT
 */

export const getAllStores = async (req: AuthRequest, res: Response) => {
  const { company_id, role, id: userId, assigned_area } = req.user as any;
  console.log('[DEBUG_STORES] User:', { userId, role, assigned_area, company_id });
  try {
    const where: any = { company_id };

    // If sales staff, only see stores in their area OR assigned to them
    if (role === 'sales') {
      where.OR = [
        { assigned_agent_id: userId },
        { area: assigned_area }
      ];
    }

    const stores = await prisma.store.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        visits: {
          orderBy: { visit_date: 'desc' },
          take: 1
        }
      }
    });

    const formattedStores = stores.map(s => ({
      ...s,
      ownerName: s.owner_name,
      assignedAgentId: s.assigned_agent_id,
      createdAt: s.created_at,
      latestVisit: s.visits[0] ? {
        ...s.visits[0],
        storeId: s.visits[0].store_id,
        agentId: s.visits[0].agent_id,
        visitDate: s.visits[0].visit_date,
        productInterest: s.visits[0].product_interest,
        nextVisitDate: s.visits[0].next_visit_date,
        createdAt: s.visits[0].created_at
      } : null
    }));
    res.json(formattedStores);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch stores', detail: error.message });
  }
};

export const createStore = async (req: AuthRequest, res: Response) => {
  const { name, owner_name, phone, address, area, city } = req.body;
  const { company_id, id: userId } = req.user as any;
  try {
    const store = await prisma.store.create({
      data: {
        id: crypto.randomUUID(),
        name,
        owner_name,
        phone,
        address,
        area,
        city,
        assigned_agent_id: userId, // Created by this staff
        company_id: company_id as string
      }
    });
    res.status(201).json({
      ...store,
      ownerName: store.owner_name,
      assignedAgentId: store.assigned_agent_id,
      createdAt: store.created_at
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create store', detail: error.message });
  }
};

export const getStoreById = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const store = await (prisma as any).store.findUnique({
      where: { id: String(id) }
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({
      ...store,
      ownerName: store.owner_name,
      assignedAgentId: store.assigned_agent_id,
      createdAt: store.created_at
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch store', detail: error.message });
  }
};

export const updateStore = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, owner_name, phone, address, area, city, assigned_agent_id } = req.body;
  try {
    const store = await prisma.store.update({
      where: { id: String(id) },
      data: { name, owner_name, phone, address, area, city, assigned_agent_id }
    });
    res.status(201).json({
      ...store,
      ownerName: store.owner_name,
      assignedAgentId: store.assigned_agent_id,
      createdAt: store.created_at
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update store', detail: error.message });
  }
};

/**
 * VISIT LOGS
 */

export const getStoreVisits = async (req: AuthRequest, res: Response) => {
  const { storeId } = req.params;
  try {
    const visits = await prisma.storeVisit.findMany({
      where: { store_id: String(storeId) },
      orderBy: { visit_date: 'desc' }
    });
    
    // Map to camelCase for frontend
    const formattedVisits = visits.map(v => ({
      ...v,
      storeId: v.store_id,
      agentId: v.agent_id,
      visitDate: v.visit_date,
      productInterest: v.product_interest,
      nextVisitDate: v.next_visit_date,
      createdAt: v.created_at
    }));
    res.json(formattedVisits);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch visits', detail: error.message });
  }
};

export const addStoreLog = async (req: AuthRequest, res: Response) => {
  const { store_id, notes, product_interest, next_visit_date, visit_date } = req.body;
  const { id: userId } = req.user as any;
  try {
    const visit = await prisma.storeVisit.create({
      data: {
        id: crypto.randomUUID(),
        store_id,
        agent_id: userId,
        visit_date: visit_date ? new Date(visit_date) : new Date(),
        notes,
        product_interest,
        next_visit_date: next_visit_date ? new Date(next_visit_date) : null
      }
    });
    res.status(201).json({
      ...visit,
      storeId: visit.store_id,
      agentId: visit.agent_id,
      visitDate: visit.visit_date,
      productInterest: visit.product_interest,
      nextVisitDate: visit.next_visit_date
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to log visit', detail: error.message });
  }
};

export const deleteStore = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    // Delete visits first, or ensure Prisma has cascade (if not, manually delete)
    await prisma.storeVisit.deleteMany({ where: { store_id: String(id) } });
    await prisma.store.delete({ where: { id: String(id) } });
    res.json({ message: 'Store deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete store', detail: error.message });
  }
};

export const updateStoreVisit = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { notes, product_interest, next_visit_date, visit_date } = req.body;
  try {
    const visit = await (prisma as any).storeVisit.update({
      where: { id: String(id) },
      data: { 
        notes, 
        product_interest, 
        visit_date: visit_date ? new Date(visit_date) : undefined,
        next_visit_date: next_visit_date ? new Date(next_visit_date) : undefined
      }
    });
    res.json({
      ...visit,
      storeId: visit.store_id,
      agentId: visit.agent_id,
      visitDate: visit.visit_date,
      productInterest: visit.product_interest,
      nextVisitDate: visit.next_visit_date
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update visit log', detail: error.message });
  }
};

export const deleteStoreVisit = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await (prisma as any).storeVisit.delete({
      where: { id: String(id) }
    });
    res.json({ message: 'Visit log deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete visit log', detail: error.message });
  }
};
