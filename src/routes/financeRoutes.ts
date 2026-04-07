import { Router } from 'express';
import * as invoiceController from '../controllers/finance/invoiceController';
import * as customerController from '../controllers/finance/customerController';
import * as vendorController from '../controllers/finance/vendorController';
import * as voucherController from '../controllers/finance/voucherController';
import * as ledgerController from '../controllers/finance/ledgerController';
import * as challanController from '../controllers/finance/challanController';
import * as gstController from '../controllers/finance/gstController';
import * as statsController from '../controllers/finance/statsController';
import * as auditController from '../controllers/system/auditController';
import { checkPermission, authorize } from '../middleware/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/finance/stats:
 *   get:
 *     summary: Get dashboard financial statistics
 *     tags: [Finance]
 *     responses:
 *       200:
 *         description: Aggregated financial stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalInvoiced: { type: number }
 *                     totalPaid: { type: number }
 *                     pendingAmount: { type: number }
 *                     customerCount: { type: number }
 *                     vendorCount: { type: number }
 *                     overdueCount: { type: number }
 *                 overdueInvoices:
 *                   type: array
 *                   items: { type: object }
 */
router.get('/finance/stats', checkPermission('mod_invoice', 'canRead') as any, statsController.getFinanceStats);

/**
 * @openapi
 * /api/invoices:
 *   get: { summary: Get invoices, tags: [Finance], responses: { 200: { description: List of invoices } } }
 *   post:
 *     summary: Create invoice
 *     tags: [Finance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: string }
 *               invoice_date: { type: string, format: date }
 *               customer_id: { type: number }
 *               customer_name: { type: string }
 *               items_json: { type: string }
 *               grand_total: { type: string }
 *     responses:
 *       201: { description: Created }
 */
router.get('/invoices', checkPermission('mod_invoice', 'canRead') as any, invoiceController.getAllInvoices);
router.get('/invoices/next-numbers', checkPermission('mod_invoice', 'canRead') as any, invoiceController.getNextNumbers);
router.post('/invoices', checkPermission('mod_invoice', 'canCreate') as any, invoiceController.createInvoice);
router.put('/invoices/:id', checkPermission('mod_invoice', 'canEdit') as any, invoiceController.updateInvoice);
router.delete('/invoices/:id', checkPermission('mod_invoice', 'canDelete') as any, invoiceController.deleteInvoice);

/**
 * @openapi
 * /api/customers:
 *   get: { summary: Get all customers, tags: [Finance] }
 *   post:
 *     summary: Create a legacy customer
 *     tags: [Finance]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customer_name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               gst: { type: string }
 *     responses:
 *       201: { description: Created }
 *       200: { description: List of customers }
 */
router.get('/customers', checkPermission('mod_customer', 'canRead') as any, customerController.getAllCustomers);
router.post('/customers', checkPermission('mod_customer', 'canCreate') as any, customerController.createCustomer);
router.put('/customers/:id', checkPermission('mod_customer', 'canEdit') as any, customerController.updateCustomer);
router.delete('/customers/:id', checkPermission('mod_customer', 'canDelete') as any, customerController.deleteCustomer);

/**
 * @openapi
 * /api/vendors:
 *   get: { summary: Get vendors, tags: [Finance], responses: { 200: { description: List of vendors } } }
 *   post:
 *     summary: Create vendor
 *     tags: [Finance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: string }
 *               name: { type: string }
 *               vendor_id: { type: string }
 *               vendor_name: { type: string }
 *               company: { type: string }
 *               phone: { type: string }
 *               street1: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *     responses:
 *       201: { description: Created }
 */
router.get('/vendors', authorize(['super_admin', 'company_admin']) as any, vendorController.getAllVendors);
router.post('/vendors', authorize(['super_admin', 'company_admin']) as any, vendorController.createVendor);
router.put('/vendors/:id', authorize(['super_admin', 'company_admin']) as any, vendorController.updateVendor);
router.delete('/vendors/:id', authorize(['super_admin', 'company_admin']) as any, vendorController.deleteVendor);

/**
 * @openapi
 * /api/vouchers:
 *   get: { summary: Get vouchers, tags: [Finance], responses: { 200: { description: List of vouchers } } }
 *   post:
 *     summary: Create voucher
 *     tags: [Finance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: string }
 *               voucher_no: { type: string }
 *               party_name: { type: string }
 *               amount: { type: number }
 *               payment_mode: { type: string }
 *     responses:
 *       201: { description: Created }
 */
router.get('/vouchers', checkPermission('mod_voucher', 'canRead') as any, voucherController.getAllVouchers);
router.post('/vouchers', checkPermission('mod_voucher', 'canCreate') as any, voucherController.createVoucher);
router.put('/vouchers/:id', checkPermission('mod_voucher', 'canEdit') as any, voucherController.updateVoucher);
router.delete('/vouchers/:id', checkPermission('mod_voucher', 'canDelete') as any, voucherController.deleteVoucher);

/**
 * @openapi
 * /api/ledger:
 *   get:
 *     summary: Get ledger entries
 *     tags: [Finance]
 *     parameters:
 *       - in: query
 *         name: partyId
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of entries }
 */
router.get('/ledger', checkPermission('mod_ledger', 'canRead') as any, ledgerController.getLedgerEntries);
router.post('/ledger', checkPermission('mod_ledger', 'canCreate') as any, ledgerController.createLedgerEntry);

/**
 * @openapi
 * /api/challans:
 *   get: { summary: Get challans, tags: [Finance], responses: { 200: { description: List of challans } } }
 *   post:
 *     summary: Create challan
 *     tags: [Finance]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: string }
 *               challan_no: { type: string }
 *               party_name: { type: string }
 *               vehicle_no: { type: string }
 *               items_json: { type: string }
 *     responses:
 *       201: { description: Created }
 */
router.get('/challans', checkPermission('mod_challan', 'canRead') as any, challanController.getAllChallans);
router.post('/challans', checkPermission('mod_challan', 'canCreate') as any, challanController.createChallan);
router.put('/challans/:id', checkPermission('mod_challan', 'canEdit') as any, challanController.updateChallan);
router.delete('/challans/:id', checkPermission('mod_challan', 'canDelete') as any, challanController.deleteChallan);

/**
 * @openapi
 * /api/gst-lookup:
 *   get: { summary: Verify any GSTIN, tags: [Finance] }
 */
router.get('/gst-lookup', gstController.getGstDetails);

/**
 * @openapi
 * /api/audit-logs:
 *   get: { summary: Get activity history, tags: [System] }
 */
router.get('/audit-logs', checkPermission('mod_user_management', 'canRead') as any, auditController.getAuditLogs);

export default router;
