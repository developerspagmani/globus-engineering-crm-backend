import { Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/authMiddleware';

export const getAllInvoices = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const user = req.user;

  // 1. Determine CompanyID - Support User context AND Direct Query Param (Snake and Camel)
  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const invoices = await (prisma as any).legacyInvoice.findMany({
      where: companyId ? { company_id: String(companyId) } : {},
      orderBy: { invoice_date: 'desc' }
    });

    console.log('--- DB RAW INVOICES SAMPLE ---', invoices[0]);

    const parsedInvoices = invoices.map((inv: any) => {
      const base = { ...inv };
      const mapped = {
        ...base,
        id: inv.id.toString(),
        invoiceNumber: inv.invoice_no?.toString() || inv.id.toString(),
        date: inv.invoice_date,
        dueDate: inv.due_date,
        customerId: inv.customer_id?.toString(),
        customerName: inv.customer_name || inv.customer?.customer_name || 'N/A',
        poNo: inv.po_no || '',
        poDate: inv.po_date,
        dcNo: inv.dc_no || '',
        dcDate: inv.dc_date,
        billType: inv.bill_type === 'with_process' ? 'With Process' :
          inv.bill_type === 'without_process' ? 'Without Process' :
            inv.bill_type === 'both' ? 'Both' : (inv.bill_type || 'With Process'),
        type: (inv.bill_type === 'with_process' ? 'INVOICE' :
          inv.bill_type === 'without_process' ? 'WOP' :
            inv.bill_type === 'both' ? 'BOTH' : 'INVOICE'),
        items: JSON.parse(inv.items_json || '[]'),
        subTotal: parseFloat(inv.total || '0'),
        grandTotal: parseFloat(inv.grand_total || '0'),
        discount: parseFloat(inv.discount || '0'),
        status: inv.status || 'DRAFT'
      };
      return mapped;
    });

    // console.log('--- FINAL MAPPED INVOICE (SENDING TO UI) ---', parsedInvoices[0]);
    res.json(parsedInvoices);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch invoices', detail: error.message });
  }
};

export const createInvoice = async (req: AuthRequest, res: Response) => {
  const {
    invoiceNumber, date, dueDate, customerId, customerName,
    address, subTotal, grandTotal, items, type, billType, inwardId, company_id, companyId, notes,
    poNo, poDate, dcNo, dcDate,
    po_no, po_date, dc_no, dc_date
  } = req.body;
  const user = req.user;
  const finalCompanyId = user?.company_id || company_id || companyId;
  // console.log('--- INVOICE CREATE: RECEIVED PAYLOAD ---', req.body);
  try {
    const invNo = invoiceNumber ? parseInt(String(invoiceNumber).replace(/\D/g, '')) : null;
    const delNo = req.body.challanNumber ? parseInt(String(req.body.challanNumber).replace(/\D/g, '')) : null;

    // Check for existing invoice/delivery numbers to ensure uniqueness
    if (invNo) {
      const existingInv = await (prisma as any).legacyInvoice.findFirst({
        where: { invoice_no: invNo, company_id: String(finalCompanyId || '').toLowerCase() }
      });
      if (existingInv) return res.status(400).json({ error: `Invoice Number ${invNo} already exists!` });
    }

    if (delNo) {
      const existingDel = await (prisma as any).legacyInvoice.findFirst({
        where: { delivery_no: delNo, company_id: String(finalCompanyId || '').toLowerCase() }
      });
      if (existingDel) return res.status(400).json({ error: `Delivery Challan Number ${delNo} already exists!` });
    }

    // Use transaction to ensure both invoice creation and inward update succeed
    const invoice = await prisma.$transaction(async (tx) => {
      // 1. Create the Invoice
      const newInvoice = await (tx as any).legacyInvoice.create({
        data: {
          invoice_no: invNo,
          delivery_no: delNo,
          invoice_date: date ? new Date(date) : new Date(),
          due_date: dueDate ? new Date(dueDate) : null,
          customer_id: customerId ? parseInt(String(customerId)) : null,
          customer_name: customerName,
          address,
          total: String(subTotal || '0'),
          grand_total: String(grandTotal || '0'),
          items_json: JSON.stringify(items || []),
          // Matching Legacy Data Format: with_process, without_process, both
          bill_type: billType === 'With Process' ? 'with_process' :
            billType === 'Without Process' ? 'without_process' :
              billType === 'Both' ? 'both' :
                'with_process',
          inward_no: invNo, // Maintain mapping for legacy consistency
          po_no: String(po_no || poNo || '').trim() || null,
          po_date: (po_date || poDate) ? new Date(po_date || poDate) : null,
          dc_no: String(dc_no || dcNo || '').trim() || null,
          dc_date: (dc_date || dcDate) ? new Date(dc_date || dcDate) : null,
          inward_id: inwardId ? String(inwardId) : null,
          company_id: String(finalCompanyId || '').toLowerCase(),
          status: 'BILLED',
          notes: notes || ''
        }
      });

      // 2. Mark Inward as completed so it disappears from "Add Invoice" list
      if (inwardId) {
        await tx.inwardEntry.update({
          where: { id: String(inwardId) },
          data: { status: 'completed' }
        });
      }

      // 3. Create a REAL Ledger Entry for the Invoice (Debt)
      const lastEntry = await tx.ledgerEntry.findFirst({
        where: {
          party_id: String(customerId),
          company_id: finalCompanyId ? String(finalCompanyId) : undefined
        },
        orderBy: { created_at: 'desc' }
      });

      const lastBalance = lastEntry ? (lastEntry.balance || 0) : 0;
      const amountAsFloat = parseFloat(grandTotal || '0');
      const newBalance = lastBalance + amountAsFloat; // Invoices INCREASE the amount owed

      await tx.ledgerEntry.create({
        data: {
          id: crypto.randomUUID(),
          party_id: String(customerId),
          party_name: customerName,
          party_type: 'customer',
          company_id: finalCompanyId ? String(finalCompanyId) : null,
          date: date ? new Date(date) : new Date(),
          type: 'debit',
          amount: amountAsFloat,
          balance: newBalance,
          description: `Invoice Generated: ${newInvoice.invoice_no}`,
          reference_id: String(newInvoice.id)
        } as any
      });

      return newInvoice;
    });

    console.log('✅ INVOICE SAVED SUCCESSFULLY:', invoice);
    res.status(201).json(invoice);
  } catch (error: any) {
    console.error('❌ INVOICE CREATION ERROR:', error);
    res.status(500).json({ error: 'Failed to create invoice', detail: error.message });
  }
};

export const updateInvoice = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  // console.log('--- INVOICE UPDATE: RECEIVED PAYLOAD ---', req.body);
  const {
    date, dueDate, customerId, customerName,
    address, subTotal, grandTotal, items, type, billType, inwardId, status, notes
  } = req.body;

  try {
    const invoice = await (prisma as any).legacyInvoice.update({
      where: { id: parseInt(String(id)) },
      data: {
        invoice_date: date ? new Date(date) : undefined,
        due_date: dueDate ? new Date(dueDate) : undefined,
        customer_id: customerId ? parseInt(String(customerId)) : undefined,
        customer_name: customerName,
        address,
        total: subTotal ? String(subTotal) : undefined,
        grand_total: grandTotal ? String(grandTotal) : undefined,
        items_json: items ? JSON.stringify(items) : undefined,
        bill_type: billType === 'With Process' ? 'with_process' :
          billType === 'Without Process' ? 'without_process' :
            billType === 'Both' ? 'both' : billType,
        inward_id: inwardId ? String(inwardId) : undefined,
        po_no: req.body.po_no || req.body.poNo,
        po_date: (req.body.po_date || req.body.poDate) ? new Date(req.body.po_date || req.body.poDate) : undefined,
        dc_no: req.body.dc_no || req.body.dcNo,
        dc_date: (req.body.dc_date || req.body.dcDate) ? new Date(req.body.dc_date || req.body.dcDate) : undefined,
        status: status?.toUpperCase(),
        notes: notes
      }
    });
    res.json(invoice);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update invoice', detail: error.message });
  }
};

export const getAllCustomers = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const customers = await prisma.legacyCustomer.findMany({
      where: companyId ? { 
        OR: [
          { company_id: String(companyId) },
          { company_id: null },
          { company_id: '' }
        ]
      } : {}
    });

    // Map to camelCase for frontend support
    const mapped = customers.map(c => ({
      id: c.id.toString(),
      name: c.customer_name,
      email: c.email,
      phone: c.phone,
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


export const getLedgerEntries = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const partyId = req.query.partyId as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        AND: [
          companyId ? {
            OR: [
              { company_id: String(companyId) },
              { company_id: String(companyId).toLowerCase() }
            ]
          } : {},
          partyId ? { party_id: String(partyId) } : {}
        ]
      },
      orderBy: { created_at: 'desc' }
    });
    res.json(entries);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch ledger entries', detail: error.message });
  }
};

export const getAllChallans = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const challans = await prisma.challan.findMany({
      where: companyId ? { 
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() }
        ]
      } : {},
      orderBy: { created_at: 'desc' }
    });
    res.json(challans.map((c: any) => ({ ...c, items: JSON.parse(c.items_json || '[]') })));
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch challans', detail: error.message });
  }
};

export const getAllVouchers = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const vouchers = await prisma.voucher.findMany({
      where: companyId ? { 
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() }
        ]
      } : {},
      orderBy: { date: 'desc' }
    });
    res.json(vouchers);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch vouchers', detail: error.message });
  }
};

export const getAllVendors = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;
  console.log(`📡 API Hit: GET /api/vendors (User: ${user?.email || 'Anonymous'}, Company: ${companyId || 'Global'})`);

  try {
    const vendors = await prisma.vendor.findMany({
      where: (companyId && process.env.AUTH !== 'false') ? { company_id: String(companyId) } : {}
    });

    // Map snake_case from DB to camelCase for Frontend
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

    console.log(`✅ SUCCESS: Found ${vendors.length} vendors in database`);
    res.json(formattedVendors);
  } catch (error: any) {
    console.error('❌ ERROR: Failed to fetch vendors:', error.message);
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
  // Support fallback to body if user object is missing company_id
  const finalCompanyId = user?.role === 'super_admin' ? (companyId || company_id) : (user?.company_id || companyId || company_id);

  try {
    const finalId = id || crypto.randomUUID();
    const vendor = await prisma.vendor.create({
      data: {
        id: finalId,
        vendor_id: finalId, // Ensure vendor_id is stored
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

export const createCustomer = async (req: AuthRequest, res: Response) => {
  const {
    name, email, phone, industry, status, street1, street2, city, area, state,
    stateCode, pinCode, contactPerson1, designation1, emailId1, phoneNumber1,
    contactPerson2, designation2, emailId2, phoneNumber2,
    contactPerson3, designation3, emailId3, phoneNumber3,
    landline, fax, gst, tin, cst, tc, vmc, hmc, paymentTerms, companyId, company_id,
    customerType
  } = req.body;

  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? (companyId || company_id) : (user?.company_id || (user as any)?.companyId || companyId || company_id);

  console.log('--- INWARD-STYLE SYNC LOG ---');
  console.log('Authorization Header:', req.headers.authorization ? 'Present (Bearer ...)' : 'MISSING');
  console.log('User Object Keys:', user ? Object.keys(user) : 'USER IS NULL');
  console.log('User.company_id:', user?.company_id);
  console.log('User.companyId (camelCase):', (user as any)?.companyId);
  console.log('Form.company_id:', company_id);
  console.log('Form.companyId (Alt):', companyId);
  console.log('RESULT: Saving to DB as:', String(finalCompanyId || ''));
  console.log('------------------------------');

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

export const createVoucher = async (req: AuthRequest, res: Response) => {
  const { id, voucher_no, date, type, party_id, party_name, party_type, amount, payment_mode, reference_no, cheque_no, description, company_id, status } = req.body;
  const user = req.user;
  const finalCompanyId = company_id || user?.company_id || (user as any)?.companyId;

  try {
    const finalAmount = parseFloat(String(amount || '0'));
    const finalId = (id && id.trim() !== '') ? id : crypto.randomUUID();

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the Voucher
      const voucher = await (tx.voucher as any).create({
        data: {
          id: finalId,
          voucher_no: voucher_no || `VCH-${Date.now()}`,
          date: date ? new Date(date) : new Date(),
          type: type || 'receipt',
          party_id: party_id ? String(party_id) : null,
          party_name: party_name || '',
          party_type: party_type || 'customer',
          amount: finalAmount,
          payment_mode: payment_mode || 'cash',
          reference_no: reference_no || '',
          cheque_no: cheque_no || '',
          description_: description || '',
          company_id: finalCompanyId ? String(finalCompanyId) : null,
          status: status || 'posted'
        }
      });

      // 2. If it's a receipt from a customer, update the Invoice and Ledger
      if (type === 'receipt' && party_type === 'customer' && reference_no) {
        // Find invoices by number (reference_no is comma separated)
        const invNumbers = reference_no.split(',').map((s: string) => s.trim()).filter(Boolean);
        
        if (invNumbers.length > 0) {
          console.log(`[VOUCHER SYNC] Attempting to find invoices: ${invNumbers.join(', ')} for company: ${finalCompanyId}`);
          
          // Smart Identification: Match both raw numbers and formatted strings (like 'INV-1')
          const invNumsAsInts = invNumbers.map((n: string) => {
            const onlyDigits = n.replace(/\D/g, ''); // Extract just digits from 'INV-1' -> '1'
            return onlyDigits ? parseInt(onlyDigits, 10) : NaN;
          }).filter((n: number) => !isNaN(n));

          console.log(`[VOUCHER SYNC] Search Terms - Raw: ${invNumbers}, As Ints: ${invNumsAsInts}`);

          // Get the invoices to update their paid amounts
          const invoices = await (tx as any).legacyInvoice.findMany({
            where: {
              OR: [
                { invoice_no: { in: invNumsAsInts } },
                { dc_no: { in: invNumbers } } // Also try matching DC No if Invoice No fails
              ],
              company_id: finalCompanyId ? String(finalCompanyId) : undefined
            }
          });

          console.log(`[VOUCHER SYNC] Found ${invoices.length} matching invoices in database.`);

          // Proportionally distribute the voucher amount among these invoices
          let remainingAmount = finalAmount;
          for (const inv of invoices) {
            if (remainingAmount <= 0) break;
            
            const currentGrandTotal = parseFloat(inv.grand_total || '0');
            const currentPaidAmount = parseFloat(inv.paid_amount || '0');
            const balanceDue = currentGrandTotal - currentPaidAmount;
            
            if (balanceDue <= 0) continue; // Already paid

            const paymentForThisInvoice = Math.min(remainingAmount, balanceDue);
            const newPaidAmount = currentPaidAmount + paymentForThisInvoice;
            
            console.log(`[VOUCHER SYNC] Updating Invoice #${inv.invoice_no}: Adding ₹${paymentForThisInvoice}. New Paid Amount: ₹${newPaidAmount}`);

            await (tx as any).legacyInvoice.update({
              where: { id: inv.id },
              data: {
                paid_amount: String(newPaidAmount),
                status: newPaidAmount >= currentGrandTotal ? 'PAID' : 'BILLED'
              }
            });
            
            remainingAmount -= paymentForThisInvoice;
          }
        }

        // 3. Create a Ledger Entry
        // Get last balance for this party
        const lastEntry = await tx.ledgerEntry.findFirst({
          where: {
            party_id: String(party_id),
            company_id: finalCompanyId ? String(finalCompanyId) : undefined
          },
          orderBy: { created_at: 'desc' }
        });

        const lastBalance = lastEntry ? (lastEntry.balance || 0) : 0;
        
        // Receipts REDUCE the balance (Credit)
        // Payments (if you were paying a vendor) would INCREASE the balance (if tracking payable)
        const newBalance = type === 'receipt' ? lastBalance - finalAmount : lastBalance + finalAmount;

        await tx.ledgerEntry.create({
          data: {
            id: crypto.randomUUID(),
            party_id: String(party_id),
            party_name: party_name,
            party_type: party_type || 'customer',
            company_id: finalCompanyId ? String(finalCompanyId) : null,
            date: date ? new Date(date) : new Date(),
            type: type === 'receipt' ? 'credit' : 'debit',
            amount: finalAmount,
            balance: newBalance,
            description: `Payment Receipt: ${voucher.voucher_no} for Invoices: ${reference_no}`,
            reference_id: voucher.voucher_no
          } as any
        });
      }

      return voucher;
    });

    res.status(201).json(result);
  } catch (error: any) {
    console.error('[Voucher Create Error Detailed]:', error);
    res.status(500).json({
      error: 'Failed to create voucher',
      message: error.message,
      code: error.code
    });
  }
};

export const createChallan = async (req: AuthRequest, res: Response) => {
  const { id, challan_no, party_id, party_name, party_type, type, status, items, vehicle_no, driver_name, company_id } = req.body;
  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? company_id : user?.company_id;

  try {
    const challan = await prisma.challan.create({
      data: {
        id,
        challan_no,
        party_id,
        party_name,
        party_type,
        company_id: finalCompanyId,
        date: new Date(),
        type,
        status: status || 'Pending',
        items_json: JSON.stringify(items || []),
        vehicle_no,
        driver_name
      }
    });

    res.status(201).json({ ...challan, items: JSON.parse(challan.items_json || '[]') });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create challan', detail: error.message });
  }
};

/**
 * Handle new Ledger Entry
 */
export const createLedgerEntry = async (req: AuthRequest, res: Response) => {
  const { partyId, partyName, partyType, date, type, amount, description, referenceId, companyId } = req.body;
  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? companyId : user?.company_id;

  try {
    const entry = await prisma.ledgerEntry.create({
      data: {
        id: crypto.randomUUID(),
        party_id: String(partyId),
        party_name: partyName,
        party_type: partyType,
        company_id: finalCompanyId,
        date: date ? new Date(date) : new Date(),
        type: type,
        amount: parseFloat(amount || '0'), // Handle both debit/credit flow in model?
        balance: 0, // Should be calculated or handled by trigger
        description: description,
        reference_id: referenceId,
      }
    });
    res.status(201).json(entry);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to add ledger entry', detail: error.message });
  }
};
/**
 * Update a vendor
 */
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

/**
 * Delete a vendor
 */
export const deleteVendor = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    await prisma.vendor.delete({ where: { id } });
    res.json({ message: 'Vendor deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete vendor', detail: error.message });
  }
};

/**
 * Update a customer
 */
export const updateCustomer = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const {
    name, email, phone, industry, status, street1, street2, city, area, state,
    stateCode, pinCode, contactPerson1, designation1, emailId1, phoneNumber1,
    contactPerson2, designation2, emailId2, phoneNumber2,
    contactPerson3, designation3, emailId3, phoneNumber3,
    landline, fax, gst, tin, cst, tc, vmc, hmc, paymentTerms, customerType
  } = req.body;

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

/**
 * Delete a customer
 */
export const deleteCustomer = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    await prisma.legacyCustomer.delete({ where: { id: parseInt(id) } });
    res.json({ message: 'Customer deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete customer', detail: error.message });
  }
};
/**
 * Update a voucher
 */
export const updateVoucher = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { voucher_no, date, type, party_id, party_name, party_type, amount, payment_mode, reference_no, cheque_no, description, status, company_id } = req.body;
  const user = req.user;

  // Use body ID if provided (from frontend fix), fallback to token
  const finalCompanyId = company_id || user?.company_id || (user as any)?.companyId;

  try {
    const voucher = await (prisma.voucher as any).update({
      where: { id: String(id) },
      data: {
        voucher_no,
        date: date ? new Date(date) : undefined,
        type,
        party_id: party_id ? String(party_id) : undefined,
        party_name,
        party_type,
        amount: amount ? parseFloat(String(amount)) : undefined,
        payment_mode,
        reference_no,
        cheque_no: cheque_no !== undefined ? String(cheque_no) : undefined,
        description_: description,
        company_id: finalCompanyId ? String(finalCompanyId) : undefined,
        status
      }
    });

    res.json(voucher);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update voucher', detail: error.message });
  }
};

/**
 * Delete a voucher
 */
export const deleteVoucher = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.voucher.delete({ where: { id: String(id) } });
    res.json({ message: 'Voucher deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete voucher', detail: error.message });
  }
};

/**
 * Update a challan
 */
export const updateChallan = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { challan_no, party_id, party_name, party_type, type, status, items, vehicle_no, driver_name } = req.body;

  try {
    const challan = await prisma.challan.update({
      where: { id: String(id) },
      data: {
        challan_no,
        party_id,
        party_name,
        party_type,
        type,
        status,
        items_json: items ? JSON.stringify(items) : undefined,
        vehicle_no,
        driver_name
      }
    });

    res.json({ ...challan, items: JSON.parse(challan.items_json || '[]') });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update challan', detail: error.message });
  }
};

/**
 * Delete a challan
 */
export const deleteChallan = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.challan.delete({ where: { id: String(id) } });
    res.json({ message: 'Challan deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete challan', detail: error.message });
  }
};

/**
 * Delete an invoice
 */
export const deleteInvoice = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    await prisma.legacyInvoice.delete({ where: { id: parseInt(String(id)) } });
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete invoice', detail: error.message });
  }
};

/**
 * GSTN Lookup (Live Portal Proxy - Authenticated Bridge)
 */
export const getGstDetails = async (req: AuthRequest, res: Response) => {
  const { gstin } = req.query;

  if (!gstin || String(gstin).length !== 15) {
    return res.status(400).json({ error: 'Valid 15-digit GSTIN is required' });
  }

  try {
    const formattedGstin = String(gstin).toUpperCase();
    
    // Authenticated Bridge to Masters India Live Portal Registry
    const uniqueId = 'K3nUOh0Sn0ZpqtfxbBcWY2M6GBnRat'; 
    const url = `https://blog-backend.mastersindia.co/api/v1/custom/search/gstin/?keyword=${formattedGstin}&unique_id=${uniqueId}`;

    console.log(`[GST-LIVE-FETCH] Querying National Registry for: ${formattedGstin}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Origin': 'https://www.mastersindia.co',
        'Referer': 'https://www.mastersindia.co/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`National Registry responded with status: ${response.status}`);
    }

    const data = (await response.json()) as any;

    if (data.error || !data.data || (!data.data.legal_name && !data.data.lgnm)) {
      return res.status(404).json({ error: data.message || 'Business entity not found in GST database' });
    }

    // Success - Return LIVE portal data
    res.json(data);
  } catch (error: any) {
    console.error('[GST-FETCH-ERROR]:', error.message);
    res.status(500).json({ error: 'Failed to synchronize with GST National Registry', detail: error.message });
  }
};

export const getNextNumbers = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const lastInvoice = await (prisma as any).legacyInvoice.findFirst({
      where: { company_id: String(companyId || '').toLowerCase() },
      orderBy: { invoice_no: 'desc' },
      select: { invoice_no: true }
    });

    const lastChallan = await (prisma as any).legacyInvoice.findFirst({
      where: { company_id: String(companyId || '').toLowerCase() },
      orderBy: { delivery_no: 'desc' },
      select: { delivery_no: true }
    });

    res.json({
      nextInvoice: (lastInvoice?.invoice_no || 0) + 1,
      nextChallan: (lastChallan?.delivery_no || 0) + 1
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch next numbers', detail: error.message });
  }
};
