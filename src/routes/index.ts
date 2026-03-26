import { Router } from 'express';
import * as companyController from '../controllers/companyController';
import * as userController from '../controllers/userController';
import * as leadController from '../controllers/leadController';
import * as logisticsController from '../controllers/logisticsController';
import * as financeController from '../controllers/financeController';
import * as employeeController from '../controllers/employeeController';
import * as authController from '../controllers/authController';
import * as masterController from '../controllers/masterController';
import { authenticate, authorize, checkPermission } from '../middleware/authMiddleware';

const router = Router();

// Auth Routes
/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: User login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post('/auth/login', authController.login);

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: string }
 *               name: { type: string }
 *               email: { type: string }
 *               password: { type: string }
 *               role: { type: string }
 *               company_id: { type: string }
 *     responses:
 *       201: { description: User created }
 */
router.post('/auth/register', authController.register);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user data
 */
router.get('/auth/me', authenticate as any, authController.getMe);

// Health check (Public)
/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: System health check
 *     tags: [System]
 *     responses:
 *       200:
 *         description: System is up and running
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), auth_disabled: process.env.AUTH === 'false' });
});

// ==========================================
// Protected Routes (Require Bearer Token)
// ==========================================
router.use(authenticate as any);

// Master Data Routes
/**
 * @openapi
 * tags:
 *   name: Master
 *   description: Master data management (Items, Processes, Price Fixing)
 */

/**
 * @openapi
 * /api/items:
 *   get:
 *     summary: Get all items
...
 */
router.get('/items', masterController.getItems);
router.post('/items', masterController.createItem);
router.put('/items/:id', masterController.updateItem);
router.delete('/items/:id', masterController.deleteItem);

/**
 * @openapi
 * /api/processes:
 *   get:
...
 */
router.get('/processes', masterController.getProcesses);
router.post('/processes', masterController.createProcess);
router.put('/processes/:id', masterController.updateProcess);
router.delete('/processes/:id', masterController.deleteProcess);

/**
 * @openapi
 * /api/price-fixings:
 *   get:
...
 */
router.get('/price-fixings', masterController.getPriceFixings);
router.post('/price-fixings', masterController.createPriceFixing);
router.put('/price-fixings/:id', masterController.updatePriceFixing);
router.delete('/price-fixings/:id', masterController.deletePriceFixing);


/**
 * @openapi
 * /api/companies:
 *   get: { summary: Retrieve all companies, tags: [Admin], responses: { 200: { description: List of companies } } }
 */
router.get('/companies', authorize(['super_admin', 'admin', 'company_admin']) as any, companyController.getAllCompanies);
router.post('/companies', authorize(['super_admin']) as any, companyController.createCompany);
router.put('/companies/:id', authorize(['super_admin']) as any, companyController.updateCompany);
router.delete('/companies/:id', authorize(['super_admin']) as any, companyController.deleteCompany);

/**
 * @openapi
 * /api/users:
 *   get: { summary: Retrieve all users, tags: [Admin], responses: { 200: { description: List of users } } }
 *   post:
 *     summary: Create a new user
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: string }
 *               name: { type: string }
 *               email: { type: string }
 *               password: { type: string }
 *               role: { type: string }
 *               company_id: { type: string }
 *     responses:
 *       201: { description: User created }
 */
router.get('/users', authorize(['super_admin', 'admin', 'company_admin']) as any, userController.getAllUsers);
router.post('/users', authorize(['super_admin', 'admin', 'company_admin']) as any, userController.createUser);

/**
 * @openapi
 * /api/users/{id}/permissions:
 *   patch:
 *     summary: Update user permissions
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               module_permissions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     moduleId: { type: string }
 *                     canRead: { type: boolean }
 *                     canCreate: { type: boolean }
 *                     canEdit: { type: boolean }
 *                     canDelete: { type: boolean }
 *     responses:
 *       200: { description: Updated }
 */
router.patch('/users/:id/permissions', authorize(['super_admin', 'admin']) as any, userController.updateUserPermissions);

// --- Sales Hub Module ---
/**
 * @openapi
 * /api/leads:
 *   get: { summary: Get all leads, tags: [Sales], responses: { 200: { description: List of leads } } }
 *   post:
 *     summary: Create a lead
 *     tags: [Sales]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: string }
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               company: { type: string }
 *               status: { type: string }
 *     responses:
 *       201: { description: Created }
 */
router.get('/leads', checkPermission('mod_lead', 'canRead') as any, leadController.getAllLeads);
router.post('/leads', checkPermission('mod_lead', 'canCreate') as any, leadController.createLead);

/**
 * @openapi
 * /api/deals:
 *   get: { summary: Get all deals, tags: [Sales], responses: { 200: { description: List of deals } } }
 *   post:
 *     summary: Create a deal
 *     tags: [Sales]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: string }
 *               title: { type: string }
 *               lead_id: { type: string }
 *               value: { type: number }
 *     responses:
 *       201: { description: Created }
 */
router.get('/deals', checkPermission('mod_sales_hub', 'canRead') as any, leadController.getAllDeals);
router.post('/deals', checkPermission('mod_sales_hub', 'canCreate') as any, leadController.createDeal);

// --- Logistics Module ---
/**
 * @openapi
 * /api/inward:
 *   get: { summary: Get all inward entries, tags: [Logistics], responses: { 200: { description: List } } }
 *   post:
 *     summary: Create inward entry
 *     tags: [Logistics]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inward_no: { type: string }
 *               customer_name: { type: string }
 *               vendor_name: { type: string }
 *               items: { type: array, items: { type: object } }
 *     responses:
 *       201: { description: Created }
 */
router.get('/inward', checkPermission('mod_inward', 'canRead') as any, logisticsController.getInwardEntries);
router.post('/inward', checkPermission('mod_inward', 'canCreate') as any, logisticsController.createInwardEntry);
router.put('/inward/:id', checkPermission('mod_inward', 'canEdit') as any, logisticsController.updateInwardEntry);
router.delete('/inward/:id', checkPermission('mod_inward', 'canDelete') as any, logisticsController.deleteInwardEntry);

/**
 * @openapi
 * /api/outward:
 *   get: { summary: Get all outward, tags: [Logistics], responses: { 200: { description: List } } }
 *   post: { summary: Create outward, tags: [Logistics], responses: { 201: { description: Created } } }
 */
router.get('/outward', checkPermission('mod_outward', 'canRead') as any, logisticsController.getOutwardEntries);
router.post('/outward', checkPermission('mod_outward', 'canCreate') as any, logisticsController.createOutwardEntry);
router.put('/outward/:id', checkPermission('mod_outward', 'canEdit') as any, logisticsController.updateOutwardEntry);
router.delete('/outward/:id', checkPermission('mod_outward', 'canDelete') as any, logisticsController.deleteOutwardEntry);

// --- Finance Module ---
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
router.get('/invoices', checkPermission('mod_invoice', 'canRead') as any, financeController.getAllInvoices);
router.get('/invoices/next-numbers', checkPermission('mod_invoice', 'canRead') as any, financeController.getNextNumbers);
router.post('/invoices', checkPermission('mod_invoice', 'canCreate') as any, financeController.createInvoice);
router.put('/invoices/:id', checkPermission('mod_invoice', 'canEdit') as any, financeController.updateInvoice);
router.delete('/invoices/:id', checkPermission('mod_invoice', 'canDelete') as any, financeController.deleteInvoice);

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
router.get('/ledger', checkPermission('mod_ledger', 'canRead') as any, financeController.getLedgerEntries);
router.post('/ledger', checkPermission('mod_ledger', 'canCreate') as any, financeController.createLedgerEntry);

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
router.get('/challans', checkPermission('mod_challan', 'canRead') as any, financeController.getAllChallans);
router.post('/challans', checkPermission('mod_challan', 'canCreate') as any, financeController.createChallan);
router.put('/challans/:id', checkPermission('mod_challan', 'canEdit') as any, financeController.updateChallan);
router.delete('/challans/:id', checkPermission('mod_challan', 'canDelete') as any, financeController.deleteChallan);

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
router.get('/vouchers', checkPermission('mod_voucher', 'canRead') as any, financeController.getAllVouchers);
router.post('/vouchers', checkPermission('mod_voucher', 'canCreate') as any, financeController.createVoucher);
router.put('/vouchers/:id', checkPermission('mod_voucher', 'canEdit') as any, financeController.updateVoucher);
router.delete('/vouchers/:id', checkPermission('mod_voucher', 'canDelete') as any, financeController.deleteVoucher);

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
router.get('/vendors', checkPermission('mod_vendor', 'canRead') as any, financeController.getAllVendors);
router.post('/vendors', checkPermission('mod_vendor', 'canCreate') as any, financeController.createVendor);
router.put('/vendors/:id', checkPermission('mod_vendor', 'canEdit') as any, financeController.updateVendor);
router.delete('/vendors/:id', checkPermission('mod_vendor', 'canDelete') as any, financeController.deleteVendor);

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
router.get('/customers', checkPermission('mod_customer', 'canRead') as any, financeController.getAllCustomers);
router.post('/customers', checkPermission('mod_customer', 'canCreate') as any, financeController.createCustomer);
router.put('/customers/:id', checkPermission('mod_customer', 'canEdit') as any, financeController.updateCustomer);
router.delete('/customers/:id', checkPermission('mod_customer', 'canDelete') as any, financeController.deleteCustomer);

/**
 * @openapi
 * /api/gst-lookup:
 *   get: { summary: Verify any GSTIN, tags: [Finance] }
 */
router.get('/gst-lookup', financeController.getGstDetails);

// --- HR Module ---
/**
 * @openapi
 * /api/employees:
 *   get: { summary: Get employees, tags: [HR] }
 */
router.get('/employees', checkPermission('mod_employee', 'canRead') as any, employeeController.getAllEmployees);

export default router;
