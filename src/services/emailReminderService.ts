import cron from 'node-cron';
import { runScheduledInvoiceReminders, processLeadVisitReminders } from '../controllers/emailReminderController';

class EmailReminderService {
  private static instance: EmailReminderService;
  private isRunning: boolean = false;

  private constructor() {}

  public static getInstance(): EmailReminderService {
    if (!EmailReminderService.instance) {
      EmailReminderService.instance = new EmailReminderService();
    }
    return EmailReminderService.instance;
  }

  public startCronJob() {
    if (this.isRunning) return;
    
    // Run daily at 10:00 AM (business morning) and 12:40 PM
    cron.schedule('0 10 * * *', async () => {
      console.log('⏰ Running morning scheduled email reminder check (10:00 AM)...');
      try {
        const invRes = await runScheduledInvoiceReminders();
        const leadCount = await processLeadVisitReminders();
        console.log(`✅ Morning reminder check complete: ${invRes.sentCount} invoice reminders, ${leadCount} lead reminders sent.`);
      } catch (error) {
        console.error('❌ Morning scheduled reminder check failed:', error);
      }
    });

    cron.schedule('40 12 * * *', async () => {
      console.log('⏰ Running afternoon scheduled email reminder check (12:40 PM)...');
      try {
        const invRes = await runScheduledInvoiceReminders();
        const leadCount = await processLeadVisitReminders();
        console.log(`✅ Afternoon reminder check complete: ${invRes.sentCount} invoice reminders, ${leadCount} lead reminders sent.`);
      } catch (error) {
        console.error('❌ Afternoon scheduled reminder check failed:', error);
      }
    });

    this.isRunning = true;
    console.log('🚀 Email reminder cron job active (Daily at 10:00 AM and 12:40 PM)');
  }
}

export default EmailReminderService;
