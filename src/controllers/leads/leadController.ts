import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { sendSingleLeadVisitReminder } from '../emailReminderController';
import { getCompanyTransporter } from '../../utils/email';

async function sendVisitNotification(leadEmail: string, leadName: string, companyName: string, visitDate: Date, companyId?: string | null) {
  const { transporter, fromName, fromEmail, source } = await getCompanyTransporter(companyId);
  if (!transporter) {
    console.error('❌ Cannot send visit notification email: SMTP is not configured in Settings or .env');
    return;
  }

  const subject = `Upcoming Visit Scheduled - ${fromName}`;
  const body = `Dear ${leadName},

This is to kindly inform you that a representative from ${fromName} is scheduled to visit your company, ${companyName || 'your office'}, on ${visitDate.toLocaleDateString()}.

We look forward to meeting with you to discuss how we can support your engineering needs. If you need to reschedule, please let us know.

Best regards,
${fromName} Team`;

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: leadEmail,
      subject,
      text: body
    });
    console.log(`✅ Visit notification sent to ${leadEmail} (Source: ${source})`);
  } catch (err) {
    console.error('❌ Failed to send lead visit email:', err);
  }
}

export const getAllLeads = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  // Pagination & Filter Params
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const search = (req.query.search as string || '').toLowerCase();
  const sortBy = req.query.sortBy as string;
  const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';

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

    const status = req.query.status as string;
    if (status && status !== 'all') {
      where.AND.push({ status: status });
    }

    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    if (fromDate || toDate) {
      const dateFilter: any = {};
      if (fromDate) dateFilter.gte = new Date(fromDate);
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        dateFilter.lte = endOfDay;
      }
      where.AND.push({ created_at: dateFilter });
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
        orderBy: sortBy ? { [sortBy]: sortOrder } : { created_at: 'desc' }
      }),
      prisma.lead.count({ where })
    ]);

    // Fetch assigned sales person details for these leads
    const agentIds = Array.from(new Set(leads.map(l => l.agent_id).filter(Boolean))) as string[];
    let agentMap = new Map<string, any>();
    if (agentIds.length > 0) {
      const agents = await prisma.user.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, name: true, email: true, phone: true }
      });
      agentMap = new Map(agents.map(a => [a.id, a]));
    }

    // Map snake_case from DB to camelCase for Frontend
    const mappedLeads = leads.map(l => {
      const agent = l.agent_id ? agentMap.get(l.agent_id) : null;
      return {
        ...l,
        agentId: l.agent_id,
        agentName: agent?.name || null,
        agentEmail: agent?.email || null,
        agentPhone: agent?.phone || null,
        companyId: l.company_id,
        assignedArea: l.assigned_area,
        createdAt: l.created_at,
        nextVisitDate: l.next_visit_date,
        productInterest: l.product_interest
      };
    });

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
  const { id, name, email, phone, company, industry, source, status, notes, assigned_area, product_interest, next_visit_date, agentId, agent_id } = req.body;
  
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
        agent_id: agentId || agent_id || user?.id,
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
  const { name, email, phone, company, industry, source, status, notes, assigned_area, product_interest, next_visit_date, agentId, agent_id } = req.body;
  
  // Validation for mandatory fields if provided
  if (name !== undefined && !name) return res.status(400).json({ error: 'Lead name is mandatory' });
  if (phone !== undefined && !phone) return res.status(400).json({ error: 'Phone number is mandatory' });

  try {
    const newNextVisitDate = next_visit_date ? new Date(next_visit_date) : null;

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
        agent_id: agentId || agent_id || undefined,
        next_visit_date: newNextVisitDate
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

// Manually send lead visit reminder to the assigned sales person on demand
export const sendLeadVisitReminder = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id || undefined;
    const result = await sendSingleLeadVisitReminder(id as string, companyId);
    res.json(result);
  } catch (err: any) {
    console.error('Error in sendLeadVisitReminder:', err);
    res.status(400).json({ error: err.message || 'Failed to send visit reminder' });
  }
};

