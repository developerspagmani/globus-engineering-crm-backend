import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getAllPurchaseBills = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  // Pagination & Filter Params
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const search = (req.query.search as string || '').toLowerCase();
  const sortBy = req.query.sortBy as string;
  const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';
  const fromDate = (req.query.fromDate as string || '').trim();
  const toDate = (req.query.toDate as string || '').trim();
  const companyName = (req.query.companyName as string || req.query.company_name as string || '').trim();
  const invoiceNo = (req.query.invoiceNo as string || req.query.invoice_no as string || '').trim();
  const dcNo = (req.query.dcNo as string || req.query.dc_no as string || req.query.challan as string || '').trim();
  const gstTin = (req.query.gstTin as string || req.query.gst_tin as string || req.query.gstin as string || '').trim();

  try {
    const where: any = {
      AND: []
    };

    if (companyId) {
      where.AND.push({
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() }
        ]
      });
    }

    if (search) {
      where.AND.push({
        OR: [
          { company_name: { contains: search } },
          { invoice_no: { contains: search } },
          { dc_no: { contains: search } },
          { gst_tin: { contains: search } }
        ]
      });
    }

    if (companyName && companyName !== 'all') {
      where.AND.push({
        company_name: { contains: companyName }
      });
    }

    if (invoiceNo && invoiceNo !== 'all') {
      where.AND.push({
        invoice_no: { contains: invoiceNo }
      });
    }

    if (dcNo && dcNo !== 'all') {
      where.AND.push({
        dc_no: { contains: dcNo }
      });
    }

    if (gstTin && gstTin !== 'all') {
      where.AND.push({
        gst_tin: { contains: gstTin }
      });
    }

    if (fromDate || toDate) {
      const dateFilter: any = {};
      if (fromDate) {
        const cleanFrom = fromDate.split('T')[0];
        const d = new Date(`${cleanFrom}T00:00:00.000Z`);
        if (!isNaN(d.getTime())) {
          dateFilter.gte = d;
        }
      }
      if (toDate) {
        const cleanTo = toDate.split('T')[0];
        const d = new Date(`${cleanTo}T23:59:59.999Z`);
        if (!isNaN(d.getTime())) {
          dateFilter.lte = d;
        }
      }
      if (Object.keys(dateFilter).length > 0) {
        where.AND.push({ received_date: dateFilter });
      }
    }

    const [purchaseBills, totalCount, aggregateData] = await Promise.all([
      prisma.purchaseBill.findMany({
        where,
        skip,
        take: limit,
        orderBy: sortBy ? { [sortBy]: sortOrder } : { received_date: 'desc' }
      }),
      prisma.purchaseBill.count({ where }),
      prisma.purchaseBill.aggregate({
        where,
        _sum: {
          amount: true,
          cgst: true,
          sgst: true,
          igst: true,
          round_off: true,
          tds: true,
          grand_total: true
        }
      })
    ]);

    const totalTaxable = aggregateData._sum.amount || 0;
    const totalCgst = aggregateData._sum.cgst || 0;
    const totalSgst = aggregateData._sum.sgst || 0;
    const totalCgstSgst = totalCgst + totalSgst;
    const totalIgst = aggregateData._sum.igst || 0;
    const totalRoundOff = aggregateData._sum.round_off || 0;
    const totalTds = aggregateData._sum.tds || 0;
    let totalGrand = aggregateData._sum.grand_total || 0;

    // Fallback: If totalGrand is zero but we have taxable total, reconstruct the grand total
    if (totalGrand <= 0 && totalTaxable > 0) {
      totalGrand = totalTaxable + totalCgstSgst + totalIgst + totalRoundOff - totalTds;
    }

    res.json({
      items: purchaseBills.map(pb => ({
        id: pb.id,
        receivedDate: pb.received_date,
        companyName: pb.company_name,
        gstTin: pb.gst_tin,
        dcNo: pb.dc_no,
        invoiceNo: pb.invoice_no,
        sac: pb.sac,
        qty: pb.qty,
        amount: pb.amount,
        cgst: pb.cgst,
        sgst: pb.sgst,
        igst: pb.igst,
        roundOff: pb.round_off,
        tds: pb.tds,
        grandTotal: pb.grand_total > 0 ? pb.grand_total : ((pb.amount || 0) + (pb.cgst || 0) + (pb.sgst || 0) + (pb.igst || 0) + (pb.round_off || 0) - (pb.tds || 0)),
        company_id: pb.company_id,
        vendorId: pb.vendor_id,
        customerId: pb.customer_id
      })),
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      },
      aggregates: {
        totalTaxable,
        totalCgst,
        totalSgst,
        totalCgstSgst,
        totalIgst,
        totalRoundOff,
        totalTds,
        totalGrand
      }
    });
  } catch (err: any) {
    console.error('Error fetching purchase bills:', err);
    res.status(500).json({ error: 'Failed to fetch purchase bills' });
  }
};

export const getPurchaseFilterOptions = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const user = req.user;
  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const where: any = companyId ? {
      OR: [
        { company_id: String(companyId) },
        { company_id: String(companyId).toLowerCase() }
      ]
    } : {};

    const bills = await prisma.purchaseBill.findMany({
      where,
      select: {
        company_name: true,
        invoice_no: true,
        dc_no: true,
        gst_tin: true
      }
    });

    const companySet = new Set<string>();
    const invoiceSet = new Set<string>();
    const challanSet = new Set<string>();
    const gstinSet = new Set<string>();

    bills.forEach(b => {
      if (b.company_name?.trim()) companySet.add(b.company_name.trim());
      if (b.invoice_no?.trim()) invoiceSet.add(b.invoice_no.trim());
      if (b.dc_no?.trim()) challanSet.add(b.dc_no.trim());
      if (b.gst_tin?.trim()) gstinSet.add(b.gst_tin.trim());
    });

    try {
      const vendors = await prisma.vendor.findMany({
        where: companyId ? { company_id: String(companyId) } : {},
        select: { name: true, company: true, gst: true }
      });
      vendors.forEach(v => {
        if (v.company?.trim()) companySet.add(v.company.trim());
        else if (v.name?.trim()) companySet.add(v.name.trim());
        if (v.gst?.trim()) gstinSet.add(v.gst.trim());
      });
    } catch (vendorErr) {
      console.warn('Vendor lookup optional:', vendorErr);
    }

    res.json({
      companies: Array.from(companySet).sort((a, b) => a.localeCompare(b)),
      invoices: Array.from(invoiceSet).sort((a, b) => a.localeCompare(b)),
      challans: Array.from(challanSet).sort((a, b) => a.localeCompare(b)),
      gstins: Array.from(gstinSet).sort((a, b) => a.localeCompare(b))
    });
  } catch (err: any) {
    console.error('Error fetching purchase filter options:', err);
    res.status(500).json({ error: 'Failed to fetch purchase filter options' });
  }
};

export const createPurchaseBill = async (req: AuthRequest, res: Response) => {
  const user = req.user;
  const companyId = user?.company_id || (user as any)?.companyId || req.body.company_id;

  if (!companyId) {
    res.status(400).json({ error: 'Company ID is required' });
    return;
  }

  const {
    receivedDate,
    companyName,
    gstTin,
    dcNo,
    invoiceNo,
    sac,
    qty,
    amount,
    cgst,
    sgst,
    igst,
    roundOff,
    tds,
    vendorId,
    customerId
  } = req.body;

  if (!receivedDate || !companyName || !invoiceNo) {
    res.status(400).json({ error: 'Received Date, Company Name, and Invoice Number are required' });
    return;
  }

  try {
    const cleanQty = parseFloat(String(qty || '0')) || 0;
    const cleanAmount = parseFloat(String(amount || '0')) || 0;
    const cleanCgst = parseFloat(String(cgst || '0')) || 0;
    const cleanSgst = parseFloat(String(sgst || '0')) || 0;
    const cleanIgst = parseFloat(String(igst || '0')) || 0;
    const cleanRoundOff = parseFloat(String(roundOff || '0')) || 0;
    const cleanTds = parseFloat(String(tds || '0')) || 0;
    
    // Auto-calculate grand total if not explicitly provided
    const cleanGrandTotal = (req.body.grandTotal !== undefined && req.body.grandTotal !== null)
      ? (parseFloat(String(req.body.grandTotal)) || 0)
      : (cleanAmount + cleanCgst + cleanSgst + cleanIgst + cleanRoundOff - cleanTds);

    const newBill = await prisma.purchaseBill.create({
      data: {
        id: crypto.randomUUID(),
        received_date: new Date(receivedDate),
        company_name: companyName,
        gst_tin: gstTin || null,
        dc_no: dcNo || null,
        invoice_no: invoiceNo,
        sac: sac || null,
        qty: cleanQty,
        amount: cleanAmount,
        cgst: cleanCgst,
        sgst: cleanSgst,
        igst: cleanIgst,
        round_off: cleanRoundOff,
        tds: cleanTds,
        grand_total: cleanGrandTotal,
        company_id: String(companyId),
        vendor_id: vendorId || null,
        customer_id: customerId || null
      }
    });

    res.status(201).json({
      id: newBill.id,
      receivedDate: newBill.received_date,
      companyName: newBill.company_name,
      gstTin: newBill.gst_tin,
      dcNo: newBill.dc_no,
      invoiceNo: newBill.invoice_no,
      sac: newBill.sac,
      qty: newBill.qty,
      amount: newBill.amount,
      cgst: newBill.cgst,
      sgst: newBill.sgst,
      igst: newBill.igst,
      roundOff: newBill.round_off,
      tds: newBill.tds,
      grandTotal: newBill.grand_total,
      company_id: newBill.company_id,
      vendorId: newBill.vendor_id,
      customerId: newBill.customer_id
    });
  } catch (err: any) {
    console.error('Error creating purchase bill:', err);
    res.status(500).json({ error: 'Failed to create purchase bill' });
  }
};

export const updatePurchaseBill = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const {
    receivedDate,
    companyName,
    gstTin,
    dcNo,
    invoiceNo,
    sac,
    qty,
    amount,
    cgst,
    sgst,
    igst,
    roundOff,
    tds,
    vendorId,
    customerId
  } = req.body;

  try {
    const existing = await prisma.purchaseBill.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Purchase bill not found' });
      return;
    }

    const cleanQty = qty !== undefined ? (parseFloat(String(qty || '0')) || 0) : existing.qty;
    const cleanAmount = amount !== undefined ? (parseFloat(String(amount || '0')) || 0) : existing.amount;
    const cleanCgst = cgst !== undefined ? (parseFloat(String(cgst || '0')) || 0) : existing.cgst;
    const cleanSgst = sgst !== undefined ? (parseFloat(String(sgst || '0')) || 0) : existing.sgst;
    const cleanIgst = igst !== undefined ? (parseFloat(String(igst || '0')) || 0) : existing.igst;
    const cleanRoundOff = roundOff !== undefined ? (parseFloat(String(roundOff || '0')) || 0) : existing.round_off;
    const cleanTds = tds !== undefined ? (parseFloat(String(tds || '0')) || 0) : existing.tds;

    // Auto-calculate grand total if not explicitly provided
    const cleanGrandTotal = (req.body.grandTotal !== undefined && req.body.grandTotal !== null)
      ? (parseFloat(String(req.body.grandTotal)) || 0)
      : (cleanAmount + cleanCgst + cleanSgst + cleanIgst + cleanRoundOff - cleanTds);

    const updatedBill = await prisma.purchaseBill.update({
      where: { id },
      data: {
        received_date: receivedDate ? new Date(receivedDate) : existing.received_date,
        company_name: companyName || existing.company_name,
        gst_tin: gstTin !== undefined ? gstTin : existing.gst_tin,
        dc_no: dcNo !== undefined ? dcNo : existing.dc_no,
        invoice_no: invoiceNo || existing.invoice_no,
        sac: sac !== undefined ? sac : existing.sac,
        qty: cleanQty,
        amount: cleanAmount,
        cgst: cleanCgst,
        sgst: cleanSgst,
        igst: cleanIgst,
        round_off: cleanRoundOff,
        tds: cleanTds,
        grand_total: cleanGrandTotal,
        vendor_id: vendorId !== undefined ? vendorId : existing.vendor_id,
        customer_id: customerId !== undefined ? customerId : existing.customer_id
      }
    });

    res.json({
      id: updatedBill.id,
      receivedDate: updatedBill.received_date,
      companyName: updatedBill.company_name,
      gstTin: updatedBill.gst_tin,
      dcNo: updatedBill.dc_no,
      invoiceNo: updatedBill.invoice_no,
      sac: updatedBill.sac,
      qty: updatedBill.qty,
      amount: updatedBill.amount,
      cgst: updatedBill.cgst,
      sgst: updatedBill.sgst,
      igst: updatedBill.igst,
      roundOff: updatedBill.round_off,
      tds: updatedBill.tds,
      grandTotal: updatedBill.grand_total,
      company_id: updatedBill.company_id,
      vendorId: updatedBill.vendor_id,
      customerId: updatedBill.customer_id
    });
  } catch (err: any) {
    console.error('Error updating purchase bill:', err);
    res.status(500).json({ error: 'Failed to update purchase bill' });
  }
};

export const deletePurchaseBill = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  try {
    const existing = await prisma.purchaseBill.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Purchase bill not found' });
      return;
    }

    await prisma.purchaseBill.delete({ where: { id } });
    res.json({ success: true, message: 'Purchase bill deleted successfully' });
  } catch (err: any) {
    console.error('Error deleting purchase bill:', err);
    res.status(500).json({ error: 'Failed to delete purchase bill' });
  }
};
