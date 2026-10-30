import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';

export const getAllCustomers = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  // Pagination & Filter Params
  const page = parseInt(req.query.page as string) || 1;
  const limit = req.query.id ? 100 : (parseInt(req.query.limit as string) || 10);
  const skip = (page - 1) * limit;
  const search = (req.query.search as string || '').toLowerCase();
  const id = req.query.id as string;
  const sortBy = req.query.sortBy as string;
  const sortOrder = (req.query.sortOrder as string) === 'desc' ? 'desc' : 'asc';

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

    if (id && id !== 'all') {
      const parsedId = parseInt(id, 10);
      if (!isNaN(parsedId)) {
        where.AND.push({ id: parsedId });
      }
    }

    if (search) {
      where.AND.push({
        OR: [
          { customer_name: { contains: search } },
          { email: { contains: search } },
          { phone: { contains: search } },
          { city: { contains: search } },
          { gst: { contains: search } }
        ]
      });
    }

    const status = req.query.status as string;
    if (status && status !== 'all') {
      where.AND.push({ status: status });
    }

    const industry = req.query.industry as string;
    if (industry && industry !== 'all') {
      where.AND.push({ industry: { contains: industry } });
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
      where.AND.push({ app_created_at: dateFilter });
    }

    const [customers, totalCount] = await Promise.all([
      prisma.legacyCustomer.findMany({
        where,
        skip,
        take: limit,
        orderBy: sortBy ? { [sortBy]: sortOrder } : { customer_name: 'asc' }
      }),
      prisma.legacyCustomer.count({ where })
    ]);

    const mapped = customers.map(c => ({
      id: c.id.toString(),
      name: c.customer_name,
      company: c.customer_name,
      email: c.email || c.email_id1 || c.email_id2 || c.email_id3,
      phone: c.phone || c.phone_number1 || c.phone_number2 || c.phone_number3,
      industry: c.industry,
      status: c.status,
      street1: c.street1,
      street2: c.street2,
      city: c.city,
      area: c.area,
      state: c.state,
      stateCode: c.state_code,
      pinCode: c.pin_code,
      contactPerson1: c.contact_person1,
      designation1: c.designation1,
      emailId1: c.email_id1,
      phoneNumber1: c.phone_number1,
      contactPerson2: c.contact_person2,
      designation2: c.designation2,
      emailId2: c.email_id2,
      phoneNumber2: c.phone_number2,
      contactPerson3: c.contact_person3,
      designation3: c.designation3,
      emailId3: c.email_id3,
      phoneNumber3: c.phone_number3,
      landline: c.land_line,
      fax: c.fax,
      gst: c.gst,
      tin: c.tin,
      cst: c.cst,
      tc: c.tc,
      vmc: c.vmc,
      hmc: c.hmc,
      paymentTerms: c.payment_terms,
      customerType: c.customer_type,
      company_id: c.company_id,
      agentId: c.agent_id
    }));

    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    res.json({
      items: mapped,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch customers', detail: error.message });
  }
};

const toSafeInt = (val: any): number | null => {
  if (val === undefined || val === null || val === '') return null;
  const cleaned = String(val).replace(/\D/g, '');
  if (!cleaned) return null;
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return null;
  if (num > 2147483647 || num < -2147483648) {
    const capped = parseInt(cleaned.slice(-9), 10);
    return isNaN(capped) ? null : capped;
  }
  return num;
};

const formatCustomerResponse = (c: any) => ({
  id: c.id.toString(),
  name: c.customer_name,
  company: c.customer_name,
  email: c.email || c.email_id1 || c.email_id2 || c.email_id3 || '',
  phone: c.phone || c.phone_number1 || c.phone_number2 || c.phone_number3 || '',
  industry: c.industry || '',
  status: c.status || 'active',
  street1: c.street1 || '',
  street2: c.street2 || '',
  city: c.city || '',
  area: c.area || '',
  state: c.state || '',
  stateCode: c.state_code || '',
  pinCode: c.pin_code != null ? String(c.pin_code) : '',
  contactPerson1: c.contact_person1 || '',
  designation1: c.designation1 || '',
  emailId1: c.email_id1 || '',
  phoneNumber1: c.phone_number1 || '',
  contactPerson2: c.contact_person2 || '',
  designation2: c.designation2 || '',
  emailId2: c.email_id2 || '',
  phoneNumber2: c.phone_number2 || '',
  contactPerson3: c.contact_person3 || '',
  designation3: c.designation3 || '',
  emailId3: c.email_id3 || '',
  phoneNumber3: c.phone_number3 || '',
  landline: c.land_line != null ? String(c.land_line) : '',
  fax: c.fax || '',
  gst: c.gst || '',
  tin: c.tin || '',
  cst: c.cst || '',
  tc: c.tc != null ? String(c.tc) : '',
  vmc: c.vmc != null ? String(c.vmc) : '',
  hmc: c.hmc != null ? String(c.hmc) : '',
  paymentTerms: c.payment_terms || '',
  customerType: c.customer_type || 'Customer',
  company_id: c.company_id || '',
  agentId: c.agent_id || '',
  createdAt: c.app_created_at,
  ...c
});

const syncCustomerToLead = async (customer: any, fallbackAgentId?: string) => {
  if (!customer || !customer.id) return;
  const leadId = `cust_${customer.id}`;
  const isLead = String(customer.status || '').toLowerCase() === 'lead';

  try {
    if (isLead) {
      const leadName = customer.contact_person1 || customer.customer_name || 'Prospect';
      const leadCompany = customer.customer_name || customer.contact_person1 || 'Company';
      const leadEmail = customer.email || customer.email_id1 || customer.email_id2 || customer.email_id3 || '';
      const leadPhone = customer.phone || customer.phone_number1 || customer.phone_number2 || customer.phone_number3 || '-';
      const leadIndustry = customer.industry || 'Automotive';
      const leadArea = customer.area || customer.city || '';
      const leadAgentId = customer.agent_id || fallbackAgentId || null;
      const leadCompanyId = customer.company_id || null;

      const existingLead = await prisma.lead.findUnique({ where: { id: leadId } });
      if (existingLead) {
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            name: leadName,
            company: leadCompany,
            email: leadEmail,
            phone: leadPhone,
            industry: leadIndustry,
            assigned_area: leadArea || existingLead.assigned_area,
            agent_id: leadAgentId || existingLead.agent_id,
            company_id: leadCompanyId || existingLead.company_id
          }
        });
      } else {
        await prisma.lead.create({
          data: {
            id: leadId,
            name: leadName,
            company: leadCompany,
            email: leadEmail,
            phone: leadPhone,
            industry: leadIndustry,
            source: 'Web',
            status: 'new',
            agent_id: leadAgentId,
            company_id: leadCompanyId,
            assigned_area: leadArea,
            created_at: customer.app_created_at || new Date()
          }
        });
      }
    } else {
      await prisma.lead.deleteMany({ where: { id: leadId } });
    }
  } catch (err) {
    console.error('Failed to sync customer to lead:', err);
  }
};

const syncCustomerToLinkedRecords = async (customer: any, oldCustomer?: any) => {
  if (!customer || !customer.id) return;
  try {
    const cleanPart = (val: any): string => {
      if (val === null || val === undefined) return '';
      const str = String(val).trim();
      return str.toLowerCase() === 'null' ? '' : str;
    };

    const formattedAddress = [
      cleanPart(customer.street1),
      cleanPart(customer.street2),
      cleanPart(customer.city),
      cleanPart(customer.state),
      cleanPart(customer.pin_code)
    ].filter(Boolean).join(', ');

    const oldFormattedAddress = oldCustomer ? [
      cleanPart(oldCustomer.street1),
      cleanPart(oldCustomer.street2),
      cleanPart(oldCustomer.city),
      cleanPart(oldCustomer.state),
      cleanPart(oldCustomer.pin_code)
    ].filter(Boolean).join(', ') : '';

    const linkedInvoices = await prisma.legacyInvoice.findMany({
      where: { customer_id: customer.id }
    });

    for (const inv of linkedInvoices) {
      const invUpdate: any = {
        customer_name: customer.customer_name || inv.customer_name,
        address: formattedAddress,
        state: customer.state ?? null,
        gstin: customer.gst ?? null
      };

      const oldName = cleanPart(oldCustomer?.customer_name).toLowerCase();
      const invCustName = cleanPart(inv.customer_name).toLowerCase();
      const invShipName = cleanPart(inv.shipping_name).toLowerCase();
      if (invShipName && (invShipName === oldName || invShipName === invCustName)) {
        invUpdate.shipping_name = customer.customer_name || inv.shipping_name;
      }

      const oldStreet1 = cleanPart(oldCustomer?.street1).toLowerCase();
      const invAddr = cleanPart(inv.address).toLowerCase();
      const invShipAddr = cleanPart(inv.shipping_address).toLowerCase();
      if (invShipAddr && (invShipAddr === invAddr || invShipAddr === oldFormattedAddress.toLowerCase() || (oldStreet1 && invShipAddr === oldStreet1))) {
        invUpdate.shipping_address = formattedAddress;
      }

      const oldState = cleanPart(oldCustomer?.state).toLowerCase();
      const invState = cleanPart(inv.state).toLowerCase();
      const invShipState = cleanPart(inv.shipping_state).toLowerCase();
      if (invShipState && (invShipState === oldState || invShipState === invState)) {
        invUpdate.shipping_state = customer.state ?? null;
      }

      const oldGst = cleanPart(oldCustomer?.gst).toLowerCase();
      const invGst = cleanPart(inv.gstin).toLowerCase();
      const invShipGst = cleanPart(inv.shipping_gstin).toLowerCase();
      if (invShipGst && (invShipGst === oldGst || invShipGst === invGst)) {
        invUpdate.shipping_gstin = customer.gst ?? null;
      }

      await prisma.legacyInvoice.update({
        where: { id: inv.id },
        data: invUpdate
      });
    }

    await prisma.inwardEntry.updateMany({
      where: { customer_id: String(customer.id) },
      data: {
        customer_name: customer.customer_name || undefined,
        address: formattedAddress || undefined
      }
    });
  } catch (err) {
    console.error('Failed to sync customer to linked records:', err);
  }
};

export const createCustomer = async (req: AuthRequest, res: Response) => {
  const {
    name, email, phone, industry, status, street1, street2, city, area, state,
    stateCode, pinCode, contactPerson1, designation1, emailId1, phoneNumber1,
    contactPerson2, designation2, emailId2, phoneNumber2,
    contactPerson3, designation3, emailId3, phoneNumber3,
    landline, fax, gst, tin, cst, tc, vmc, hmc, paymentTerms, companyId, company_id,
    customerType, agentId, agent_id
  } = req.body;

  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? (companyId || company_id || user?.company_id) : (user?.company_id || (user as any)?.companyId || companyId || company_id);

  try {
    const customer = await prisma.legacyCustomer.create({
      data: {
        customer_name: name ?? req.body.customer_name ?? req.body.company,
        email: email ?? req.body.email,
        phone: phone ?? req.body.phone,
        industry: industry ?? req.body.industry,
        status: status || 'active',
        street1: street1 ?? req.body.street1,
        street2: street2 ?? req.body.street2,
        city: city ?? req.body.city,
        area: area ?? req.body.area,
        state: state ?? req.body.state,
        state_code: stateCode ?? req.body.state_code,
        pin_code: toSafeInt(pinCode ?? req.body.pin_code),
        contact_person1: contactPerson1 ?? req.body.contact_person1,
        designation1: designation1 ?? req.body.designation1,
        email_id1: emailId1 ?? req.body.email_id1,
        phone_number1: phoneNumber1 ?? req.body.phone_number1,
        contact_person2: contactPerson2 ?? req.body.contact_person2,
        designation2: designation2 ?? req.body.designation2,
        email_id2: emailId2 ?? req.body.email_id2,
        phone_number2: phoneNumber2 ?? req.body.phone_number2,
        contact_person3: contactPerson3 ?? req.body.contact_person3,
        designation3: designation3 ?? req.body.designation3,
        email_id3: emailId3 ?? req.body.email_id3,
        phone_number3: phoneNumber3 ?? req.body.phone_number3,
        land_line: toSafeInt(landline ?? req.body.land_line),
        gst: gst ?? req.body.gst,
        tin: tin ?? req.body.tin,
        cst: cst ?? req.body.cst,
        tc: toSafeInt(tc ?? req.body.tc),
        vmc: toSafeInt(vmc ?? req.body.vmc),
        hmc: toSafeInt(hmc ?? req.body.hmc),
        payment_terms: paymentTerms ?? req.body.payment_terms,
        customer_type: customerType ?? req.body.customer_type,
        fax: fax ?? req.body.fax,
        company_id: String(finalCompanyId || user?.company_id || ''),
        agent_id: agentId || agent_id || user?.id
      }
    });

    await syncCustomerToLead(customer, user?.id);

    res.status(201).json(formatCustomerResponse(customer));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create customer', detail: error.message });
  }
};

export const updateCustomer = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const parsedId = parseInt(id, 10);
  if (isNaN(parsedId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }

  const {
    name, email, phone, industry, status, street1, street2, city, area, state,
    stateCode, pinCode, contactPerson1, designation1, emailId1, phoneNumber1,
    contactPerson2, designation2, emailId2, phoneNumber2,
    contactPerson3, designation3, emailId3, phoneNumber3,
    landline, fax, gst, tin, cst, tc, vmc, hmc, paymentTerms, customerType,
    company_id, companyId
  } = req.body;

  try {
    const updateData: any = {
      customer_name: name ?? req.body.customer_name ?? req.body.company,
      email: email ?? req.body.email,
      phone: phone ?? req.body.phone,
      industry: industry ?? req.body.industry,
      status: status ?? req.body.status,
      street1: street1 ?? req.body.street1,
      street2: street2 ?? req.body.street2,
      city: city ?? req.body.city,
      area: area ?? req.body.area,
      state: state ?? req.body.state,
      state_code: stateCode ?? req.body.state_code,
      pin_code: toSafeInt(pinCode ?? req.body.pin_code),
      contact_person1: contactPerson1 ?? req.body.contact_person1,
      designation1: designation1 ?? req.body.designation1,
      email_id1: emailId1 ?? req.body.email_id1,
      phone_number1: phoneNumber1 ?? req.body.phone_number1,
      contact_person2: contactPerson2 ?? req.body.contact_person2,
      designation2: designation2 ?? req.body.designation2,
      email_id2: emailId2 ?? req.body.email_id2,
      phone_number2: phoneNumber2 ?? req.body.phone_number2,
      contact_person3: contactPerson3 ?? req.body.contact_person3,
      designation3: designation3 ?? req.body.designation3,
      email_id3: emailId3 ?? req.body.email_id3,
      phone_number3: phoneNumber3 ?? req.body.phone_number3,
      land_line: toSafeInt(landline ?? req.body.land_line),
      gst: gst ?? req.body.gst,
      tin: tin ?? req.body.tin,
      cst: cst ?? req.body.cst,
      tc: toSafeInt(tc ?? req.body.tc),
      vmc: toSafeInt(vmc ?? req.body.vmc),
      hmc: toSafeInt(hmc ?? req.body.hmc),
      payment_terms: paymentTerms ?? req.body.payment_terms,
      customer_type: customerType ?? req.body.customer_type,
      fax: fax ?? req.body.fax
    };

    const targetCompanyId = companyId || company_id;
    if (targetCompanyId) {
      updateData.company_id = String(targetCompanyId);
    }

    const oldCustomer = await prisma.legacyCustomer.findUnique({
      where: { id: parsedId }
    });

    const customer = await prisma.legacyCustomer.update({
      where: { id: parsedId },
      data: updateData
    });

    await syncCustomerToLead(customer, req.user?.id);
    await syncCustomerToLinkedRecords(customer, oldCustomer);

    res.json(formatCustomerResponse(customer));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update customer', detail: error.message });
  }
};

export const deleteCustomer = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    await prisma.legacyCustomer.delete({ where: { id: parseInt(id) } });
    await prisma.lead.deleteMany({ where: { id: `cust_${parseInt(id)}` } }).catch(() => {});
    res.json({ message: 'Customer deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete customer', detail: error.message });
  }
};
