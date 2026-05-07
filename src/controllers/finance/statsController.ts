import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';

/**
 * Aggregates financial data for the dashboard
 */
export const getFinanceStats = async (req: AuthRequest, res: Response) => {
  const companyId = req.user?.company_id;

  if (!companyId) {
    return res.status(400).json({ error: 'Company ID is required for dashboard statistics.' });
  }

  try {
    // 1. Run queries in parallel to save time and reduce connection hold duration
    const [invoices, customerCount, vendorCount, latestInvoices, latestInwards] = await Promise.all([
      prisma.legacyInvoice.findMany({
        where: { company_id: companyId },
        select: {
          id: true,
          grand_total: true,
          paid_amount: true,
          status: true,
          due_date: true,
          invoice_date: true,
          invoice_no: true,
          customer_name: true
        }
      }),
      prisma.legacyCustomer.count({ where: { company_id: companyId, status: 'active' } }),
      prisma.vendor.count({ where: { company_id: companyId, status: 'active' } }),
      prisma.legacyInvoice.findMany({
        where: { company_id: companyId },
        orderBy: [
          { invoice_date: 'desc' },
          { app_created_at: 'desc' }
        ],
        take: 10,
        select: {
          id: true,
          invoice_no: true,
          invoice_date: true,
          customer_name: true,
          grand_total: true,
          status: true
        }
      }),
      prisma.inwardEntry.findMany({
        where: { company_id: companyId },
        orderBy: [
          { date: 'desc' },
          { created_at: 'desc' }
        ],
        take: 10,
        select: {
          id: true,
          inward_no: true,
          date: true,
          vendor_name: true,
          customer_name: true,
          status: true
        }
      })
    ]);

    let totalInvoiced = 0;
    let totalPaid = 0;
    let overdueCount = 0;
    const overdueInvoices: any[] = [];

    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    invoices.forEach(inv => {
      // Safely parse decimals from strings
      const grandTotal = parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0;
      const paidAmount = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;

      totalInvoiced += grandTotal;
      totalPaid += paidAmount;

      // Check if overdue (> 30 days old and not fully paid)
      const cleanStatus = (inv.status || '').trim().toUpperCase();
      const isPaidStatus = cleanStatus === 'PAID' || cleanStatus === 'COMPLETED';
      const isUnpaid = paidAmount < (grandTotal - 0.01) && !isPaidStatus;
      const dueDate = inv.due_date || inv.invoice_date;

      if (isUnpaid && dueDate && dueDate < thirtyDaysAgo) {
        overdueCount++;
        if (overdueInvoices.length < 10) {
          overdueInvoices.push({
            id: inv.id,
            invoice_no: inv.invoice_no,
            customer: inv.customer_name,
            amount: grandTotal,
            pending: Math.max(0, grandTotal - paidAmount),
            due_date: dueDate
          });
        }
      }
    });

    res.json({
      summary: {
        totalInvoiced: Math.round(totalInvoiced * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        pendingAmount: Math.round((totalInvoiced - totalPaid) * 100) / 100,
        customerCount,
        vendorCount,
        overdueCount
      },
      overdueInvoices,
      latestInvoices,
      latestInwards
    });

  } catch (error: any) {
    console.error('DASHBOARD STATS ERROR:', error);

    // Handle Connection Failures (P1001) specifically for Hostinger Remote MySQL
    if (error.code === 'P1001') {
      return res.status(503).json({
        error: 'Database Connection Error',
        detail: 'The backend cannot reach the Hostinger MySQL server. Please ensure your current IP is whitelisted in Hostinger Remote MySQL settings.',
        host: 'srv1214.hstgr.io'
      });
    }

    res.status(500).json({
      error: 'Failed to aggregate dashboard data',
      detail: error.message
    });
  }
};
