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
  const fromDate = req.query.fromDate as string;
  const toDate = req.query.toDate as string;

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

    if (fromDate || toDate) {
      const dateFilter: any = {};
      if (fromDate) dateFilter.gte = new Date(fromDate);
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        dateFilter.lte = endOfDay;
      }
      where.AND.push({ received_date: dateFilter });
    }

    const [purchaseBills, totalCount] = await Promise.all([
      prisma.purchaseBill.findMany({
        where,
        skip,
        take: limit,
        orderBy: { received_date: 'desc' }
      }),
      prisma.purchaseBill.count({ where })
    ]);

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
        grandTotal: pb.grand_total,
        company_id: pb.company_id,
        vendorId: pb.vendor_id
      })),
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (err: any) {
    console.error('Error fetching purchase bills:', err);
    res.status(500).json({ error: 'Failed to fetch purchase bills' });
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
    vendorId
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
    
    // Auto-calculate grand total
    const cleanGrandTotal = cleanAmount + cleanCgst + cleanSgst + cleanIgst + cleanRoundOff;

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
        grand_total: cleanGrandTotal,
        company_id: String(companyId),
        vendor_id: vendorId || null
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
      grandTotal: newBill.grand_total,
      company_id: newBill.company_id,
      vendorId: newBill.vendor_id
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
    vendorId
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

    // Auto-calculate grand total
    const cleanGrandTotal = cleanAmount + cleanCgst + cleanSgst + cleanIgst + cleanRoundOff;

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
        grand_total: cleanGrandTotal,
        vendor_id: vendorId !== undefined ? vendorId : existing.vendor_id
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
      grandTotal: updatedBill.grand_total,
      company_id: updatedBill.company_id,
      vendorId: updatedBill.vendor_id
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
