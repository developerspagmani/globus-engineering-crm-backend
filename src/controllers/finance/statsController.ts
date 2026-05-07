import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';

/**
 * Aggregates financial data for the dashboard
 */
export const getFinanceStats = async (req: AuthRequest, res: Response) => {
  const user = req.user;
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const companyId = queryCompanyId || user?.company_id || (user as any)?.companyId;

  if (!companyId && user?.role !== 'super_admin') {
    return res.status(400).json({ error: 'Company ID is required for dashboard statistics.' });
  }

  try {
    // 1. Run queries in parallel to save time and reduce connection hold duration
    const companyWhere = {
      OR: [
        { company_id: String(companyId) },
        { company_id: { contains: String(companyId) } },
        { company_id: { contains: String(companyId).toLowerCase() } },
        { company_id: { contains: String(companyId).toUpperCase() } }
      ]
    };

    const [invoices, customerCount, vendorCount, latestInvoices, latestInwards] = await Promise.all([
      prisma.legacyInvoice.findMany({
        where: companyWhere,
        select: {
          id: true,
          total: true,
          grand_total: true,
          paid_amount: true,
          status: true,
          due_date: true,
          invoice_date: true,
          invoice_no: true,
          customer_name: true,
          sub_total: true,
          tax_total: true
        }
      }),
      prisma.legacyCustomer.count({ where: { AND: [companyWhere, { status: 'active' }] } }),
      prisma.vendor.count({ where: { AND: [companyWhere, { status: 'active' }] } }),
      prisma.legacyInvoice.findMany({
        where: companyWhere,
        orderBy: [
          { invoice_date: 'desc' },
          { id: 'desc' }
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
        where: companyWhere,
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
    const pendingInvoices: any[] = [];
    let overdueCount = 0;

    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    invoices.forEach(inv => {
      // Use Float columns if available, otherwise parse legacy String columns
      const taxable = inv.sub_total ?? (parseFloat(String(inv.total || '0').replace(/[^\d.]/g, '')) || 0);
      const taxVal  = inv.tax_total ?? (parseFloat(String(inv.tax_total || '0').replace(/[^\d.]/g, '')) || 0);
      
      let grand = parseFloat(String(inv.grand_total || '0').replace(/[^\d.]/g, '')) || 0;
      
      // Fallback: Reconstruct grand total if string column is zero/empty
      if (grand <= 0 && taxable > 0) {
          grand = taxable + taxVal;
      }

      const paid = parseFloat(String(inv.paid_amount || '0').replace(/[^\d.]/g, '')) || 0;

      totalInvoiced += grand;
      totalPaid += paid;

      // Check if unpaid (balance > 0.5 and status is not paid/completed)
      const cleanStatus = (inv.status || '').trim().toUpperCase();
      const isPaidStatus = cleanStatus === 'PAID' || cleanStatus === 'COMPLETED';
      const isUnpaid = (grand - paid) > 0.5 && !isPaidStatus;
      const dueDate = inv.due_date || inv.invoice_date;

      if (isUnpaid) {
        pendingInvoices.push({
          id: inv.id,
          invoice_no: inv.invoice_no,
          customer: inv.customer_name,
          amount: grand,
          pending: Math.max(0, grand - paid),
          due_date: dueDate
        });

        // Still track overdue count (> 30 days) for the stat card
        if (dueDate && new Date(dueDate) < thirtyDaysAgo) {
          overdueCount++;
        }
      }
    });

    // Sort by invoice_date descending and take top 10
    const overdueInvoices = pendingInvoices
      .sort((a, b) => {
        const dateA = new Date(a.due_date || 0).getTime();
        const dateB = new Date(b.due_date || 0).getTime();
        if (dateB !== dateA) return dateB - dateA;
        return b.id - a.id; // Use ID as tie-breaker for "latest created"
      })
      .slice(0, 10);

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
