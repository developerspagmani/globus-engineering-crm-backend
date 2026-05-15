import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import crypto from 'crypto';

const mapCompany = (company: any) => {
  let parsedSettings = {};
  try {
    parsedSettings = company.invoice_settings ? JSON.parse(company.invoice_settings) : {};
    if (!parsedSettings || typeof parsedSettings !== 'object') {
        parsedSettings = {};
    }
  } catch (e) {
    console.error(`Failed to parse invoice_settings for company ${company.id}`, e);
    parsedSettings = {};
  }

  return {
    ...company,
    activeModules: (() => {
        try {
            return company.active_modules ? JSON.parse(company.active_modules) : [];
        } catch (e) {
            console.error(`Failed to parse active_modules for company ${company.id}`, e);
            return [];
        }
    })(),

    logo: company.logo,
    logoSecondary: company.logo_secondary,
    invoiceSettings: {
      ...parsedSettings,
      companyName: company.company_name || (parsedSettings as any).companyName,
      companySubHeader: company.company_sub_header || (parsedSettings as any).companySubHeader,
      companyAddress: company.company_address || (parsedSettings as any).companyAddress,
      gstNo: company.gst_no || (parsedSettings as any).gstNo,
      stateDetails: company.state_details || (parsedSettings as any).stateDetails,
      vatTin: company.vat_tin || (parsedSettings as any).vatTin,
      cstNo: company.cst_no || (parsedSettings as any).cstNo,
      panNo: company.pan_no || (parsedSettings as any).panNo,
      bankName: company.bank_name || (parsedSettings as any).bankName,
      bankAcc: company.bank_acc || (parsedSettings as any).bankAcc,
      bankBranchIfsc: company.bank_branch_ifsc || (parsedSettings as any).bankBranchIfsc,
      declarationText: company.declaration_text || (parsedSettings as any).declarationText,
    }
  };
};


export const getCompanyById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const company = await prisma.company.findUnique({
      where: { id: String(id) }
    });
    
    if (!company) return res.status(404).json({ error: 'Company not found' });

    res.json(mapCompany(company));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch company', detail: error.message });
  }
};

export const getAllCompanies = async (req: Request, res: Response) => {
  try {
    const companies = await prisma.company.findMany();
    // Prevent browser/CDN caching so deleted companies disappear immediately
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(companies.map(mapCompany));
  } catch (error: any) {
    console.error('CRITICAL ERROR in getAllCompanies:', error);
    res.status(500).json({ error: 'Failed to fetch companies', detail: error.message });
  }
};



export const createCompany = async (req: Request, res: Response) => {
  const { name, slug, plan, activeModules, logo, logoSecondary, invoiceSettings } = req.body;
  
  // Validation for basic fields
  if (!name || !slug || !plan) {
    return res.status(400).json({ error: 'Name, slug, and plan are mandatory' });
  }

  try {
    const company = await prisma.company.create({
      data: {
        id: crypto.randomUUID(),
        name,
        slug,
        plan,
        active_modules: JSON.stringify(activeModules || []),
        logo: logo || null,
        logo_secondary: logoSecondary || null,
        invoice_settings: JSON.stringify(invoiceSettings || null)
      } as any
    });
    res.status(201).json({ 
        ...company, 
        activeModules: activeModules || [],
        invoiceSettings: invoiceSettings || null
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create company', detail: error.message });
  }
};

export const updateCompany = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, slug, plan, activeModules, logo, logoSecondary, invoiceSettings } = req.body;
  
  try {
    const updateData: any = {};
    
    if (name !== undefined) {
      if (!name) return res.status(400).json({ error: 'Company name cannot be empty' });
      updateData.name = name;
    }
    if (slug !== undefined) updateData.slug = slug;
    if (plan !== undefined) updateData.plan = plan;
    if (activeModules !== undefined) updateData.active_modules = JSON.stringify(activeModules);
    
    if (logo !== undefined) updateData.logo = logo;
    if (logoSecondary !== undefined) updateData.logo_secondary = logoSecondary;
    
    if (invoiceSettings !== undefined) {
      // Validate mandatory invoice settings if provided
      const requiredFields = [
        'companyName', 
        'companyAddress', 
        'gstNo', 
        'bankName', 
        'bankAcc', 
        'bankBranchIfsc',
        'stateDetails'
      ];
      
      const missingFields = requiredFields.filter(f => !invoiceSettings[f]);
      
      // If any mandatory field is missing, we still allow update but maybe we should warn?
      // For now, let's just ensure they are sync'd to columns if they exist.
      
      updateData.invoice_settings = JSON.stringify(invoiceSettings);
      
      // Also sync to separate columns for better persistence/visibility
      if (invoiceSettings.companyName) updateData.company_name = invoiceSettings.companyName;
      if (invoiceSettings.companySubHeader) updateData.company_sub_header = invoiceSettings.companySubHeader;
      if (invoiceSettings.companyAddress) updateData.company_address = invoiceSettings.companyAddress;
      if (invoiceSettings.gstNo) updateData.gst_no = invoiceSettings.gstNo;
      if (invoiceSettings.stateDetails) updateData.state_details = invoiceSettings.stateDetails;
      if (invoiceSettings.vatTin) updateData.vat_tin = invoiceSettings.vatTin;
      if (invoiceSettings.cstNo) updateData.cst_no = invoiceSettings.cstNo;
      if (invoiceSettings.panNo) updateData.pan_no = invoiceSettings.panNo;
      if (invoiceSettings.bankName) updateData.bank_name = invoiceSettings.bankName;
      if (invoiceSettings.bankAcc) updateData.bank_acc = invoiceSettings.bankAcc;
      if (invoiceSettings.bankBranchIfsc) updateData.bank_branch_ifsc = invoiceSettings.bankBranchIfsc;
      if (invoiceSettings.declarationText) updateData.declaration_text = invoiceSettings.declarationText;
    }

    const company = await prisma.company.update({
      where: { id: String(id) },
      data: updateData
    });

    res.json(mapCompany(company));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update company', detail: error.message });
  }
};

export const deleteCompany = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // Nullify all related FK references first (schema lacks onDelete:Cascade)
    // Without this, MySQL FK constraint blocks the delete and company persists in dropdown
    await prisma.$transaction(async (tx) => {
      // Unlink users from this company
      await (tx.user as any).updateMany({
        where: { company_id: String(id) },
        data: { company_id: null }
      });
      // Unlink leads
      await (tx.lead as any).updateMany({
        where: { company_id: String(id) },
        data: { company_id: null }
      });
      // Unlink deals
      await (tx.deal as any).updateMany({
        where: { company_id: String(id) },
        data: { company_id: null }
      });
      // Delete invoice reminders linked to this company (has onDelete:Cascade but explicit is safer)
      await (tx.invoiceReminder as any).deleteMany({
        where: { companyId: String(id) }
      });
      // Finally delete the company
      await tx.company.delete({ where: { id: String(id) } });
    });
    res.json({ message: 'Company deleted successfully' });
  } catch (error: any) {
    console.error('❌ COMPANY DELETE ERROR:', error);
    res.status(500).json({ error: 'Failed to delete company', detail: error.message });
  }
};

