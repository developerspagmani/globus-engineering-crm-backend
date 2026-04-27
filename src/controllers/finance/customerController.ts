import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';

export const getAllCustomers = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const customers = await prisma.legacyCustomer.findMany({
      where: companyId ? { 
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() }
        ]
      } : {}
    });


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

    res.json(mapped);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch customers', detail: error.message });
  }
};

export const createCustomer = async (req: AuthRequest, res: Response) => {
  const {
    name, email, phone, industry, status, street1, street2, city, area, state,
    stateCode, pinCode, contactPerson1, designation1, emailId1, phoneNumber1,
    contactPerson2, designation2, emailId2, phoneNumber2,
    contactPerson3, designation3, emailId3, phoneNumber3,
    landline, fax, gst, tin, cst, tc, vmc, hmc, paymentTerms, companyId, company_id,
    customerType
  } = req.body;

  // Validation for mandatory fields
  const missingFields = [];
  if (!name) missingFields.push('name');
  if (!phone) missingFields.push('phone');
  if (!street1) missingFields.push('street1');
  if (!city) missingFields.push('city');
  if (!state) missingFields.push('state');
  if (!pinCode) missingFields.push('pinCode');

  if (missingFields.length > 0) {
    return res.status(400).json({ 
      error: 'Missing mandatory fields', 
      fields: missingFields 
    });
  }

  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? (companyId || company_id) : (user?.company_id || (user as any)?.companyId || companyId || company_id);

  try {
    const customer = await prisma.legacyCustomer.create({
      data: {
        customer_name: name,
        email,
        phone,
        industry,
        status: status || 'active',
        street1,
        street2,
        city,
        area,
        state,
        state_code: stateCode,
        pin_code: pinCode ? parseInt(String(pinCode)) : null,
        contact_person1: contactPerson1,
        designation1: designation1,
        email_id1: emailId1,
        phone_number1: phoneNumber1,
        contact_person2: contactPerson2,
        designation2: designation2,
        email_id2: emailId2,
        phone_number2: phoneNumber2,
        contact_person3: contactPerson3,
        designation3: designation3,
        email_id3: emailId3,
        phone_number3: phoneNumber3,
        land_line: landline ? parseInt(String(landline).replace(/\D/g, '')) : null,
        gst,
        tin,
        cst,
        tc: tc ? parseInt(String(tc).replace(/\D/g, '')) : null,
        vmc: vmc ? parseInt(String(vmc).replace(/\D/g, '')) : null,
        hmc: hmc ? parseInt(String(hmc).replace(/\D/g, '')) : null,
        payment_terms: paymentTerms,
        customer_type: customerType,
        fax,
        company_id: String(finalCompanyId || ''),
        agent_id: user?.id
      }
    });

    res.status(201).json(customer);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create customer', detail: error.message });
  }
};

export const updateCustomer = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const {
    name, email, phone, industry, status, street1, street2, city, area, state,
    stateCode, pinCode, contactPerson1, designation1, emailId1, phoneNumber1,
    contactPerson2, designation2, emailId2, phoneNumber2,
    contactPerson3, designation3, emailId3, phoneNumber3,
    landline, fax, gst, tin, cst, tc, vmc, hmc, paymentTerms, customerType
  } = req.body;

  // Validation for mandatory fields if they are provided in the update
  if (name !== undefined && !name) return res.status(400).json({ error: 'Customer name is mandatory' });
  if (phone !== undefined && !phone) return res.status(400).json({ error: 'Phone number is mandatory' });
  if (street1 !== undefined && !street1) return res.status(400).json({ error: 'Street address is mandatory' });
  if (city !== undefined && !city) return res.status(400).json({ error: 'City is mandatory' });
  if (state !== undefined && !state) return res.status(400).json({ error: 'State is mandatory' });
  if (pinCode !== undefined && !pinCode) return res.status(400).json({ error: 'Pin code is mandatory' });

  try {
    const customer = await prisma.legacyCustomer.update({
      where: { id: parseInt(id) },
      data: {
        customer_name: name,
        email,
        phone,
        industry,
        status,
        street1,
        street2,
        city,
        area,
        state,
        state_code: stateCode,
        pin_code: pinCode ? parseInt(String(pinCode)) : null,
        contact_person1: contactPerson1,
        designation1: designation1,
        email_id1: emailId1,
        phone_number1: phoneNumber1,
        contact_person2: contactPerson2,
        designation2: designation2,
        email_id2: emailId2,
        phone_number2: phoneNumber2,
        contact_person3: contactPerson3,
        designation3: designation3,
        email_id3: emailId3,
        phone_number3: phoneNumber3,
        land_line: landline ? parseInt(String(landline).replace(/\D/g, '')) : null,
        gst,
        tin,
        cst,
        tc: tc ? parseInt(String(tc).replace(/\D/g, '')) : null,
        vmc: vmc ? parseInt(String(vmc).replace(/\D/g, '')) : null,
        hmc: hmc ? parseInt(String(hmc).replace(/\D/g, '')) : null,
        payment_terms: paymentTerms,
        customer_type: customerType,
        fax
      }
    });

    res.json(customer);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update customer', detail: error.message });
  }
};

export const deleteCustomer = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    await prisma.legacyCustomer.delete({ where: { id: parseInt(id) } });
    res.json({ message: 'Customer deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete customer', detail: error.message });
  }
};
