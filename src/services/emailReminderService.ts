import cron from 'node-cron';
import prisma from '../config/prisma';
import { runScheduledInvoiceReminders, processLeadVisitReminders } from '../controllers/emailReminderController';

class EmailReminderService {
  private static instance: EmailReminderService;
  private isRunning: boolean = false;
  private processedSlotsThisHour: Set<string> = new Set();

  private constructor() {}

  public static getInstance(): EmailReminderService {
    if (!EmailReminderService.instance) {
      EmailReminderService.instance = new EmailReminderService();
    }
    return EmailReminderService.instance;
  }

  public startCronJob() {
    if (this.isRunning) return;

    // Run every minute to check dynamic company reminder schedules
    cron.schedule('* * * * *', async () => {
      await this.checkAndRunReminders();
    });

    // Cleanup deduplication slot keys daily at midnight
    cron.schedule('0 0 * * *', () => {
      this.processedSlotsThisHour.clear();
    });

    this.isRunning = true;
    console.log('🚀 Dynamic Email Reminder Scheduler active (Checking per-company time-based configurations)');
  }

  private async checkAndRunReminders() {
    try {
      // Calculate current time & day in Indian Standard Time (IST - UTC+05:30)
      const now = new Date();
      const istDate = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
      const hours = String(istDate.getUTCHours()).padStart(2, '0');
      const minutes = String(istDate.getUTCMinutes()).padStart(2, '0');
      const currentClock = `${hours}:${minutes}`;
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const currentDay = dayNames[istDate.getUTCDay()];
      const todayDateStr = istDate.toISOString().split('T')[0];

      // Fetch all companies
      const companies = await prisma.company.findMany();

      for (const comp of companies) {
        let smtpConfig: any = null;
        if (comp.invoice_settings) {
          try {
            const parsed = JSON.parse(comp.invoice_settings);
            smtpConfig = parsed?.smtp || null;
          } catch (e) {}
        }

        // Default settings if company has not customized
        const enableAutoReminders = smtpConfig?.enableAutoReminders !== false;
        const enableLeadReminders = smtpConfig?.enableLeadReminders !== false;
        if (!enableAutoReminders && !enableLeadReminders) continue;

        const reminderDaysOfWeek = smtpConfig?.reminderDaysOfWeek || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const isDayAllowed = reminderDaysOfWeek.includes('all') || reminderDaysOfWeek.includes(currentDay);
        if (!isDayAllowed) continue;

        const primaryTime = smtpConfig?.reminderExecutionTime || '10:00';
        const enableSecondary = smtpConfig?.enableSecondaryTime !== false;
        const secondaryTime = smtpConfig?.secondaryExecutionTime || '12:40';

        const shouldRunNow = (currentClock === primaryTime) || (enableSecondary && currentClock === secondaryTime);

        if (shouldRunNow) {
          const slotKey = `${comp.id}_${todayDateStr}_${currentClock}`;
          if (this.processedSlotsThisHour.has(slotKey)) {
            continue; // Already executed in this minute
          }
          this.processedSlotsThisHour.add(slotKey);

          console.log(`⏰ Executing scheduled email reminders for ${comp.name} at ${currentClock} IST...`);
          try {
            const invRes = await runScheduledInvoiceReminders(comp.id);
            const leadCount = await processLeadVisitReminders(comp.id);

            // Record execution metadata in company settings
            if (comp.invoice_settings) {
              try {
                const parsed = JSON.parse(comp.invoice_settings);
                if (parsed?.smtp) {
                  parsed.smtp.lastRunTimestamp = new Date().toISOString();
                  parsed.smtp.lastRunStats = {
                    totalSent: invRes.sentCount + leadCount,
                    invoicesSent: invRes.sentCount,
                    leadRemindersSent: leadCount
                  };
                  await prisma.company.update({
                    where: { id: comp.id },
                    data: { invoice_settings: JSON.stringify(parsed) }
                  });
                }
              } catch (e) {}
            }

            console.log(`✅ Reminders dispatched for ${comp.name}: ${invRes.sentCount} invoice(s), ${leadCount} lead(s)`);
          } catch (err) {
            console.error(`❌ Scheduled reminder run failed for ${comp.name}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('Error in EmailReminderService cron tick:', err);
    }
  }
}

export default EmailReminderService;
