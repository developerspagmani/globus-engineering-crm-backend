import { Router } from 'express';
import * as emailReminderController from '../controllers/emailReminderController';

const router = Router();

// Get reminder toggle status for an invoice
router.get('/invoices/:id/reminder-status', emailReminderController.getReminderStatus);

// Update reminder toggle status for an invoice
router.put('/invoices/:id/reminder-status', emailReminderController.updateReminderStatus);

// Manually trigger reminder processing (useful for testing or manual runs)
router.get('/email-reminder-service', emailReminderController.processEmailReminders);

// TEST ROUTE: Send sample email for 8840
router.get('/send-test-8840', emailReminderController.sendTestEmail8840);

export default router;
