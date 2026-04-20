import { Router } from 'express';
import authRoutes from './authRoutes';
import companyRoutes from './companyRoutes';
import userRoutes from './userRoutes';
import leadRoutes from './leadRoutes';
import logisticsRoutes from './logisticsRoutes';
import financeRoutes from './financeRoutes';
import masterRoutes from './masterRoutes';
import employeeRoutes from './employeeRoutes';
import storeRoutes from './storeRoutes';
import emailReminderRoutes from './emailReminderRoutes';

import * as companyController from '../controllers/company/companyController';
import * as gstController from '../controllers/finance/gstController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

// ==========================================
// Public Routes
// ==========================================

// API root info
router.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Globus CRM API is structured correctly.',
    auth_enabled: process.env.AUTH !== 'false',
    available_modules: ['leads', 'deals', 'invoices', 'inventory', 'hr']
  });
});

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(), 
    auth_disabled: process.env.AUTH === 'false' 
  });
});

// Auth Routes (Pre-fixed with /auth)
router.use('/auth', authRoutes);

// Organization fetch for login
router.get('/companies', companyController.getAllCompanies);

// Public lookups
router.get('/gst-lookup', gstController.getGstDetails);

// Email Reminders (Publicly accessible for cron job/manual trigger)
router.use('/', emailReminderRoutes);

// ==========================================
// Protected Routes (Require Bearer Token)
// ==========================================
router.use(authenticate as any);

// All these routes are defined within their respective files (e.g., /leads, /invoices)
router.use('/', companyRoutes);    // Handles /companies
router.use('/', userRoutes);       // Handles /users
router.use('/', leadRoutes);       // Handles /leads, /deals
router.use('/', logisticsRoutes);  // Handles /inward, /outward
router.use('/', financeRoutes);    // Handles /invoices, /ledger, /challans, /vouchers, /vendors, /customers
router.use('/', masterRoutes);     // Handles /items, /processes, /price-fixings
router.use('/', employeeRoutes);   // Handles /employees
router.use('/stores', storeRoutes);      // Handles /stores, /stores/visit, etc.


export default router;
