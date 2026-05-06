import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getAllLeads = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  // Pagination & Filter Params
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const search = (req.query.search as string || '').toLowerCase();

  try {
    const where: any = {
      AND: []
    };
    
    if (companyId) {
      where.AND.push({
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() },
          { company_id: String(companyId).toUpperCase() }
        ]
      });
    }

    if (search) {
      where.AND.push({
        OR: [
          { name: { contains: search.toLowerCase() } },
          { name: { contains: search.toUpperCase() } },
          { email: { contains: search.toLowerCase() } },
          { email: { contains: search.toUpperCase() } },
          { phone: { contains: search.toLowerCase() } },
          { phone: { contains: search.toUpperCase() } },
          { company: { contains: search.toLowerCase() } },
          { company: { contains: search.toUpperCase() } }
        ]
      });
    }

    // Security: Sales users see leads in their assigned area OR leads they created themselves
    if (user?.role === 'sales') {
      const salesFilter: any = {
        OR: [
          { agent_id: user.id }
        ]
      };
      
      if (user.assigned_area) {
        salesFilter.OR.push({ assigned_area: user.assigned_area });
      }
      
      where.AND.push(salesFilter);
    }

    const [leads, totalCount] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      }),
      prisma.lead.count({ where })
    ]);

    // Map snake_case from DB to camelCase for Frontend
    const mappedLeads = leads.map(l => ({
      ...l,
      agentId: l.agent_id,
      companyId: l.company_id,
      assignedArea: l.assigned_area,
      createdAt: l.created_at,
      nextVisitDate: l.next_visit_date,
      productInterest: l.product_interest
    }));

    res.json({
      items: mappedLeads,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch leads', detail: error.message });
  }
};

export const createLead = async (req: AuthRequest, res: Response) => {
  const { id, name, email, phone, company, industry, source, status, notes, assigned_area, product_interest, next_visit_date } = req.body;
  
  // Validation for mandatory fields
  if (!name) return res.status(400).json({ error: 'Lead name is mandatory' });
  if (!phone) return res.status(400).json({ error: 'Phone number is mandatory' });

  const user = req.user;

  try {
    const lead = await prisma.lead.create({
      data: {
        id: id || crypto.randomUUID(),
        name,
        email,
        phone,
        company,
        industry,
        source,
        status: status || 'new',
        agent_id: user?.id,
        company_id: user?.company_id,
        notes,
        assigned_area,
        product_interest,
        next_visit_date: next_visit_date ? new Date(next_visit_date) : null
      }
    });
    
    const mappedLead = {
      ...lead,
      agentId: lead.agent_id,
      companyId: lead.company_id,
      assignedArea: lead.assigned_area,
      createdAt: lead.created_at,
      nextVisitDate: lead.next_visit_date,
      productInterest: lead.product_interest
    };

    res.status(201).json(mappedLead);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create lead', detail: error.message });
  }
};


export const updateLead = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { name, email, phone, company, industry, source, status, notes, assigned_area, product_interest, next_visit_date } = req.body;
  
  // Validation for mandatory fields if provided
  if (name !== undefined && !name) return res.status(400).json({ error: 'Lead name is mandatory' });
  if (phone !== undefined && !phone) return res.status(400).json({ error: 'Phone number is mandatory' });

  try {
    const lead = await prisma.lead.update({
      where: { id },
      data: { 
        name, 
        email, 
        phone, 
        company, 
        industry, 
        source, 
        status, 
        notes,
        assigned_area,
        product_interest,
        next_visit_date: next_visit_date ? new Date(next_visit_date) : null
      }
    });

    const mappedLead = {
      ...lead,
      agentId: lead.agent_id,
      companyId: lead.company_id,
      assignedArea: lead.assigned_area,
      createdAt: lead.created_at,
      nextVisitDate: lead.next_visit_date,
      productInterest: lead.product_interest
    };

    res.json(mappedLead);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update lead', detail: error.message });
  }
};

export const deleteLead = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    await prisma.lead.delete({ where: { id } });
    res.json({ message: 'Lead deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete lead', detail: error.message });
  }
};
