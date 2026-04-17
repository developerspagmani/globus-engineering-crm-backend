import { Router } from 'express';
import * as emailReminderController from '../controllers/emailReminderController';

const router = Router();

// Get reminder toggle status for an invoice
router.get('/api/invoices/:id/reminder-status', emailReminderController.getReminderStatus);

// Update reminder toggle status for an invoice
router.put('/api/invoices/:id/reminder-status', emailReminderController.updateReminderStatus);

// Manually trigger reminder processing (useful for testing or manual runs)
router.get('/api/email-reminder-service', emailReminderController.processEmailReminders);

export default router;
