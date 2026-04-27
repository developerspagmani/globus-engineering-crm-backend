import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import crypto from 'crypto';

const mapCompany = (company: any) => {
  const parsedSettings = company.invoice_settings ? JSON.parse(company.invoice_settings) : {};
  return {
    ...company,
    activeModules: company.active_modules ? JSON.parse(company.active_modules) : [],
    logo: company.logo,
    logoSecondary: company.logo_secondary,
    invoiceSettings: {
      ...parsedSettings,
      companyName: company.company_name || parsedSettings.companyName,
      companySubHeader: company.company_sub_header || parsedSettings.companySubHeader,
      companyAddress: company.company_address || parsedSettings.companyAddress,
      gstNo: company.gst_no || parsedSettings.gstNo,
      stateDetails: company.state_details || parsedSettings.stateDetails,
      vatTin: company.vat_tin || parsedSettings.vatTin,
      cstNo: company.cst_no || parsedSettings.cstNo,
      panNo: company.pan_no || parsedSettings.panNo,
      bankName: company.bank_name || parsedSettings.bankName,
      bankAcc: company.bank_acc || parsedSettings.bankAcc,
      bankBranchIfsc: company.bank_branch_ifsc || parsedSettings.bankBranchIfsc,
      declarationText: company.declaration_text || parsedSettings.declarationText,
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
    res.json(companies.map(mapCompany));
  } catch (error: any) {
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
    await prisma.company.delete({ where: { id: String(id) } });
    res.json({ message: 'Company deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete company', detail: error.message });
  }
};
