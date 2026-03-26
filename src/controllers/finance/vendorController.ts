import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';

export const getAllVendors = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const vendors = await prisma.vendor.findMany({
      where: (companyId && process.env.AUTH !== 'false') ? { company_id: String(companyId) } : {}
    });

    const formattedVendors = vendors.map((v: any) => ({
      id: v.id,
      name: v.name,
      company: v.company,
      email: v.email_ || '',
      phone: v.phone,
      category: v.category,
      status: v.status,
      vendorType: v.vendor_type || 'vendor',
      street1: v.street1,
      street2: v.street2,
      city: v.city,
      area: v.area,
      state: v.state,
      stateCode: v.state_code,
      pinCode: v.pin_code,
      contactPerson1: v.contact_person1,
      designation1: v.designation1,
      emailId1: v.email_id1,
      phoneNumber1: v.phone_number1,
      contactPerson2: v.contact_person2,
      designation2: v.designation2,
      emailId2: v.email_id2,
      phoneNumber2: v.phone_number2,
      contactPerson3: v.contact_person3,
      designation3: v.designation3,
      emailId3: v.email_id3,
      phoneNumber3: v.phone_number3,
      landline: v.landline,
      gst: v.gst,
      tin: v.tin,
      cst: v.cst,
      fax: v.fax,
      companyId: v.company_id
    }));

    res.json(formattedVendors);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch vendors', detail: error.message });
  }
};

export const createVendor = async (req: AuthRequest, res: Response) => {
  const {
    id, name, email, phone, company, category, status, companyId, company_id,
    street1, street2, city, area, state, stateCode, pinCode,
    contactPerson1, designation1, emailId1, phoneNumber1,
    contactPerson2, designation2, emailId2, phoneNumber2,
    contactPerson3, designation3, emailId3, phoneNumber3,
    landline, fax, gst, tin, cst, vendorType
  } = req.body;

  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? (companyId || company_id) : (user?.company_id || companyId || company_id);

  try {
    const finalId = id || crypto.randomUUID();
    const vendor = await prisma.vendor.create({
      data: {
        id: finalId,
        vendor_id: finalId,
        name,
        vendor_name: name,
        email_: email,
        phone,
        company,
        category,
        company_id: String(finalCompanyId || ''),
        status: status || 'Active',
        street1,
        street2,
        city,
        area,
        state,
        state_code: stateCode,
        pin_code: pinCode,
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
        landline,
        fax,
        gst,
        tin,
        cst,
        vendor_type: vendorType || 'vendor'
      }
    });

    res.status(201).json(vendor);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create vendor', detail: error.message });
  }
};

export const updateVendor = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { name, email, phone, company, category, status, street1, city, state, gst } = req.body;

  try {
    const vendor = await prisma.vendor.update({
      where: { id },
      data: {
        name,
        email_: email,
        phone,
        company,
        category,
        status,
        street1,
        city,
        state,
        gst
      }
    });

    res.json(vendor);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update vendor', detail: error.message });
  }
};

export const deleteVendor = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    await prisma.vendor.delete({ where: { id } });
    res.json({ message: 'Vendor deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete vendor', detail: error.message });
  }
};
