import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

async function sendVisitNotification(leadEmail: string, leadName: string, companyName: string, visitDate: Date) {
  if (!process.env.SMTP_HOST) {
    console.error('SMTP_HOST not defined, skipping visit notification email.');
    return;
  }
  
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const subject = `Upcoming Visit Scheduled - Globus Engineering`;
  const body = `Dear ${leadName},

This is to kindly inform you that a representative from Globus Engineering is scheduled to visit your company, ${companyName || 'your office'}, on ${visitDate.toLocaleDateString()}.

We look forward to meeting with you to discuss how we can support your engineering needs. If you need to reschedule, please let us know.

Best regards,
Globus Engineering Team`;

  try {
    await transporter.sendMail({
      from: `"${process.env.FROM_NAME || 'Globus Engineering'}" <${process.env.FROM_EMAIL || 'noreply@globusengineering.com'}>`,
      to: 'rdhanushkumarramalingam@gmail.com', // HARDCODED FOR TESTING
      subject,
      text: body
    });
    console.log(`✅ Visit notification sent to rdhanushkumarramalingam@gmail.com (Original: ${leadEmail})`);
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

    // Send email notification if next_visit_date is set and email is provided
    if (mappedLead.nextVisitDate && mappedLead.email) {
      sendVisitNotification(mappedLead.email, mappedLead.name, mappedLead.company || '', mappedLead.nextVisitDate).catch(console.error);
    }
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
    // Check existing lead to see if next_visit_date is changing
    const existingLead = await prisma.lead.findUnique({ where: { id } });

    const newNextVisitDate = next_visit_date ? new Date(next_visit_date) : null;
    const isDateChanged = existingLead && (
      (!existingLead.next_visit_date && newNextVisitDate) ||
      (existingLead.next_visit_date && newNextVisitDate && existingLead.next_visit_date.getTime() !== newNextVisitDate.getTime())
    );

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

    // Send email notification if next_visit_date is newly set or changed
    if (isDateChanged && mappedLead.nextVisitDate && mappedLead.email) {
      sendVisitNotification(mappedLead.email, mappedLead.name, mappedLead.company || '', mappedLead.nextVisitDate).catch(console.error);
    }
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
