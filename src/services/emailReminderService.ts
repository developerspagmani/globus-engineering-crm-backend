import cron from 'node-cron';
import axios from 'axios';

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
    
    // Run every day at 9:00 AM
    cron.schedule('0 9 * * *', async () => {
      console.log('⏰ Running scheduled email reminder check...');
      try {
        // We can call the controller logic directly or via an internal request
        // For simplicity and to avoid circular deps, we can just trigger the endpoint
        const port = process.env.PORT || 4000;
        await axios.get(`http://localhost:${port}/api/email-reminder-service`);
        console.log('✅ Scheduled reminder check completed.');
      } catch (error) {
        console.error('❌ Scheduled reminder check failed:', error);
      }
    });

    this.isRunning = true;
    console.log('🚀 Email reminder cron job started (Daily at 9:00 AM)');
  }
}

export default EmailReminderService;
