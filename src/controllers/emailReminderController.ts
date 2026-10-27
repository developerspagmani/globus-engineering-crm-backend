import { Request, Response } from 'express';
import { runScheduledInvoiceReminders } from './reminders/invoiceReminderController';
import { processLeadVisitReminders } from './reminders/leadReminderController';

/**
 * Email Reminder Controller Hub
 * 
 * Central controller coordinating invoice payment reminders and lead visit alerts.
 * Re-exports all modular functions for 100% backward compatibility.
 */

export * from './reminders/reminderCommon';
export * from './reminders/invoiceReminderController';
export * from './reminders/leadReminderController';
export * from './reminders/mailSettingsController';

// GET /api/email-reminder-service - Trigger automated reminders (Invoices + Leads)
export const processEmailReminders = async (req: Request, res: Response) => {
  try {
    const { company_id } = req.query;
    const { sentCount, results } = await runScheduledInvoiceReminders(company_id as string | undefined);
    const leadSentCount = await processLeadVisitReminders(company_id as string | undefined);

    res.json({
      success: true,
      totalSent: sentCount + leadSentCount,
      invoicesSent: sentCount,
      leadRemindersSent: leadSentCount,
      details: results
    });
  } catch (error: any) {
    console.error('Error processing reminders:', error);
    res.status(500).json({ error: 'Failed to process reminders', detail: error.message });
  }
};
