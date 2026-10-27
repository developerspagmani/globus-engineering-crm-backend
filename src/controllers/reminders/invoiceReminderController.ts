import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import { 
  formatINR, 
  prepareInvoicePDF, 
  generateEmailContent, 
  sendEmail, 
  calculateReminderDates 
} from './reminderCommon';

// GET /api/invoices/:id/reminder-status - Get reminder status for an invoice
export const getReminderStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    const parsedId = parseInt(id as string);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Valid invoice ID is required' });
    }

    // Lookup invoice by either legacy id or invoice_no
    const invoice = await prisma.legacyInvoice.findFirst({
      where: {
        OR: [
          { id: parsedId },
          { invoice_no: parsedId }
        ],
        ...(company_id && typeof company_id === 'string' ? { company_id } : {})
      },
      include: {
        customer: true,
        reminders: true
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: `Invoice #${id} not found` });
    }

    // Check if reminder toggle setting exists
    const reminderSetting = invoice.reminders?.find(
      r => !company_id || r.companyId === (company_id as string)
    );

    const isEnabled = reminderSetting ? reminderSetting.enabled : true;

    // Check last sent email log
    const lastLog = await prisma.emailLog.findFirst({
      where: {
        invoiceId: invoice.id,
        status: 'sent'
      },
      orderBy: {
        emailSent: 'desc'
      }
    });

    const sentCount = await prisma.emailLog.count({
      where: {
        invoiceId: invoice.id,
        status: 'sent'
      }
    });

    const customerEmail = 
      invoice.customer?.email_id1 || 
      invoice.customer?.email_id2 || 
      invoice.customer?.email_id3 || 
      invoice.customer?.email || 
      null;

    const grand = parseFloat(invoice.grand_total || '0');
    const paid = parseFloat(invoice.paid_amount || '0');
    const isPaid = (invoice.status?.toUpperCase() === 'PAID') || 
                   (invoice.status?.toUpperCase() === 'COMPLETED') ||
                   (grand > 0 && paid >= (grand - 0.5));

    res.json({
      success: true,
      enabled: isEnabled,
      invoiceId: invoice.id,
      invoiceNo: invoice.invoice_no,
      customerName: invoice.customer_name || invoice.customer?.customer_name || '',
      customerEmail: customerEmail,
      dueDate: invoice.due_date,
      dcDate: invoice.dc_date,
      status: invoice.status,
      isPaid,
      lastSent: lastLog?.emailSent || null,
      lastReminderType: lastLog?.reminderType || null,
      totalSentCount: sentCount
    });
  } catch (error) {
    console.error('Error fetching reminder status:', error);
    res.status(500).json({ error: 'Failed to fetch reminder status' });
  }
};

// PUT /api/invoices/:id/reminder-status - Update reminder status for an invoice
export const updateReminderStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, enabled } = req.body;

    if (!company_id || typeof company_id !== 'string' || typeof enabled !== 'boolean') {
      return res.status(400).json({ 
        error: 'Company ID (string) and enabled status (boolean) are required' 
      });
    }

    const parsedId = parseInt(id as string);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Valid invoice ID is required' });
    }

    // Resolve actual LegacyInvoice id in case invoice_no was passed
    const invoice = await prisma.legacyInvoice.findFirst({
      where: {
        OR: [
          { id: parsedId },
          { invoice_no: parsedId }
        ]
      },
      select: { id: true, invoice_no: true }
    });

    const targetInvoiceId = invoice ? invoice.id : parsedId;

    const reminder = await prisma.invoiceReminder.upsert({
      where: {
        invoiceId_companyId: {
          invoiceId: targetInvoiceId,
          companyId: company_id
        }
      },
      update: {
        enabled,
        updatedAt: new Date()
      },
      create: {
        invoiceId: targetInvoiceId,
        companyId: company_id,
        enabled,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: `Reminders ${enabled ? 'enabled' : 'disabled'} for Invoice #${invoice ? invoice.invoice_no : id}`,
      enabled: reminder.enabled
    });
  } catch (error) {
    console.error('Error updating reminder status:', error);
    res.status(500).json({ error: 'Failed to update reminder status' });
  }
};

// POST /api/invoices/:id/send-reminder - Manually send an invoice reminder on-demand
export const sendInvoiceReminder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, recipientEmail, customNote } = req.body;

    const parsedId = parseInt(id as string);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Valid invoice ID is required' });
    }

    const invoice = await prisma.legacyInvoice.findFirst({
      where: {
        OR: [
          { id: parsedId },
          { invoice_no: parsedId }
        ],
        ...(company_id && typeof company_id === 'string' ? { company_id } : {})
      },
      include: {
        customer: true,
        reminders: true
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: `Invoice #${id} not found` });
    }

    const rawEmail = recipientEmail?.trim() || 
      invoice.customer?.email_id1?.trim() || 
      invoice.customer?.email_id2?.trim() || 
      invoice.customer?.email_id3?.trim() || 
      invoice.customer?.email?.trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!rawEmail || !emailRegex.test(rawEmail)) {
      return res.status(400).json({ 
        error: 'No valid recipient email address found. Please enter or provide a customer email address.',
        customerName: invoice.customer_name || invoice.customer?.customer_name || 'Customer'
      });
    }

    // Generate accurate PDF
    const pdfBuffer = await prepareInvoicePDF(invoice);

    // Email content (plain text + HTML)
    const emailContent = generateEmailContent(invoice, 'manual', customNote);

    // Send email via nodemailer
    const result = await sendEmail(
      rawEmail,
      emailContent.subject,
      emailContent.body,
      [
        {
          filename: `Invoice_${invoice.invoice_no || invoice.id}.pdf`,
          content: pdfBuffer
        }
      ],
      emailContent.html,
      invoice.company_id || (company_id as string)
    );

    if (!result.success) {
      if (invoice.id && invoice.customer_id) {
        await prisma.emailLog.create({
          data: {
            invoiceId: invoice.id,
            customerId: invoice.customer_id,
            reminderType: 'manual_reminder',
            emailSent: new Date(),
            recipientEmail: rawEmail,
            status: 'failed',
            errorMessage: result.error || 'SMTP delivery failed'
          }
        }).catch((err) => console.error('Failed to log failed email:', err));
      }

      return res.status(500).json({ 
        error: `Failed to send email: ${result.error || 'SMTP delivery error'}` 
      });
    }

    // Log success in EmailLog
    if (invoice.id && invoice.customer_id) {
      await prisma.emailLog.create({
        data: {
          invoiceId: invoice.id,
          customerId: invoice.customer_id,
          reminderType: 'manual_reminder',
          emailSent: new Date(),
          recipientEmail: rawEmail,
          status: 'sent'
        }
      }).catch((err) => console.error('Failed to log sent email:', err));
    }

    res.json({
      success: true,
      message: `Reminder email successfully sent to ${rawEmail}`,
      recipient: rawEmail,
      invoiceNo: invoice.invoice_no || invoice.id
    });
  } catch (error: any) {
    console.error('Error sending invoice reminder:', error);
    res.status(500).json({ error: error.message || 'Failed to send reminder email' });
  }
};

/**
 * Core function to process automated invoice payment reminders based on
 * 'Automated Invoice Payment Reminders (Date-Based Milestones)' configuration.
 */
export const runScheduledInvoiceReminders = async (companyId?: string) => {
  let sentCount = 0;
  const results: any[] = [];
  const processedInvoiceNos = new Set<string>();

  try {
    // 1. Fetch relevant companies and their MailSettings / milestone configuration
    const companies = await prisma.company.findMany(
      companyId ? { where: { id: companyId } } : undefined
    );

    const companyConfigMap = new Map<string, {
      company: any;
      enableAutoReminders: boolean;
      reminderSchedule: string[];
      customDaysBefore: number[];
      customDaysAfter: number[];
    }>();

    for (const comp of companies) {
      let smtpConfig: any = null;
      if (comp.invoice_settings) {
        try {
          smtpConfig = JSON.parse(comp.invoice_settings)?.smtp || null;
        } catch (e) {}
      }

      const enableAutoReminders = smtpConfig?.enableAutoReminders !== false;
      const reminderSchedule = Array.isArray(smtpConfig?.reminderSchedule) && smtpConfig.reminderSchedule.length > 0
        ? smtpConfig.reminderSchedule
        : ['30_days', '1_week', '1_day', 'today', 'overdue_7_days', 'overdue_15_days'];

      const customDaysBefore = (smtpConfig?.customReminderDaysBefore || '')
        .split(',')
        .map((s: string) => parseInt(s.trim(), 10))
        .filter((n: number) => !isNaN(n) && n > 0);

      const customDaysAfter = (smtpConfig?.customReminderDaysAfter || '')
        .split(',')
        .map((s: string) => parseInt(s.trim(), 10))
        .filter((n: number) => !isNaN(n) && n > 0);

      companyConfigMap.set(comp.id, {
        company: comp,
        enableAutoReminders,
        reminderSchedule,
        customDaysBefore,
        customDaysAfter
      });
    }

    if (companyId) {
      const cfg = companyConfigMap.get(companyId);
      if (cfg && !cfg.enableAutoReminders) {
        console.log(`ℹ️ Automated reminders are paused in settings for company ${companyId}`);
        return { 
          sentCount: 0, 
          results: [{ status: 'skipped', reason: 'Automated reminders are paused in Mail Settings for this company' }] 
        };
      }
    }

    const whereInvoice: any = {
      // Exclude cancelled or paid invoices
      status: {
        notIn: ['PAID', 'COMPLETED', 'CANCELLED', 'cancelled', 'paid', 'completed']
      }
    };

    if (companyId) {
      whereInvoice.company_id = companyId;
    }

    // Only process invoices created within the last 18 months for performance
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 18);
    whereInvoice.invoice_date = { gte: cutoffDate };

    const invoices = await prisma.legacyInvoice.findMany({
      where: whereInvoice,
      include: {
        reminders: true,
        customer: true
      },
      orderBy: {
        invoice_date: 'desc'
      },
      take: 1000 // Process up to 1000 invoices per sweep
    });

    // Inward due date resolution if invoice has inward_id and no due_date
    const inwardIds = invoices
      .filter(inv => !inv.due_date && inv.inward_id)
      .map(inv => inv.inward_id as string);
    
    let inwardDueDateMap = new Map<string, any>();
    if (inwardIds.length > 0) {
      const inwards = await prisma.inwardEntry.findMany({
        where: { id: { in: inwardIds } },
        select: { id: true, due_date: true }
      });
      inwardDueDateMap = new Map(inwards.map(i => [i.id, (i as any).due_date]));
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Batch pre-fetch all email logs for this invoice set to eliminate N+1 queries inside loop
    const invoiceIds = invoices.map(inv => inv.id);
    const existingLogs = invoiceIds.length > 0 ? await prisma.emailLog.findMany({
      where: { invoiceId: { in: invoiceIds } },
      select: { invoiceId: true, reminderType: true, emailSent: true }
    }) : [];

    const sentMilestones = new Set(existingLogs.map(l => `${l.invoiceId}_${l.reminderType}`));
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const sentTodayInvoices = new Set(
      existingLogs.filter(l => l.emailSent && new Date(l.emailSent) >= todayMidnight).map(l => l.invoiceId)
    );

    // IST Normalization (UTC+05:30) for calendar date calculation
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowUtc = Date.now();
    const istNow = new Date(nowUtc + istOffset);
    const todayCalendar = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));

    // Map of standard milestone IDs to calendar day offsets
    const MILESTONE_OFFSETS: Record<string, number> = {
      '60_days': 60,
      '30_days': 30,
      '15_days': 15,
      '1_week': 7,
      '3_days': 3,
      '1_day': 1,
      'today': 0,
      'overdue_3_days': -3,
      'overdue_7_days': -7,
      'overdue_15_days': -15,
      'overdue_30_days': -30,
    };

    for (const invoice of invoices) {
      // 1. Skip if already processed in this batch
      const dupKey = `${invoice.invoice_no || invoice.id}_${invoice.customer_id}`;
      if (processedInvoiceNos.has(dupKey)) continue;
      processedInvoiceNos.add(dupKey);

      // 2. Check if invoice is paid based on financial figures
      const grand = parseFloat(invoice.grand_total || '0');
      const paid = parseFloat(invoice.paid_amount || '0');
      if (grand > 0 && paid >= (grand - 0.5)) {
        continue; // Fully paid, skip
      }

      // 3. Check if reminders are explicitly disabled for this invoice
      const reminderSetting = invoice.reminders?.find(r => !invoice.company_id || r.companyId === invoice.company_id);
      if (reminderSetting && reminderSetting.enabled === false) {
        continue; // Manually disabled
      }

      // 4. Resolve company configuration
      const targetCompanyId = invoice.company_id || companyId || '';
      const compConfig = companyConfigMap.get(targetCompanyId);

      // If company has disabled auto reminders, skip
      if (compConfig && !compConfig.enableAutoReminders) {
        continue;
      }

      const activeSchedule = compConfig?.reminderSchedule || [
        '30_days', '1_week', '1_day', 'today', 'overdue_7_days', 'overdue_15_days'
      ];
      const customBefore = compConfig?.customDaysBefore || [];
      const customAfter = compConfig?.customDaysAfter || [];

      // 5. Resolve effective due date (fall back to invoice_date + 30 days if neither due_date nor inward exists)
      let effectiveDueDate: Date | null = invoice.due_date ? new Date(invoice.due_date) : null;
      if (!effectiveDueDate && invoice.inward_id) {
        const inwardDue = inwardDueDateMap.get(invoice.inward_id);
        if (inwardDue) effectiveDueDate = new Date(inwardDue);
      }
      if (!effectiveDueDate && invoice.invoice_date) {
        const d = new Date(invoice.invoice_date);
        d.setDate(d.getDate() + 30);
        effectiveDueDate = d;
      }

      if (!effectiveDueDate || isNaN(effectiveDueDate.getTime())) continue;

      // 6. Calculate diffDays (days remaining until due date in calendar terms)
      const dueIst = new Date(effectiveDueDate.getTime() + istOffset);
      const dueCalendar = new Date(Date.UTC(dueIst.getUTCFullYear(), dueIst.getUTCMonth(), dueIst.getUTCDate()));
      const diffDays = Math.round((dueCalendar.getTime() - todayCalendar.getTime()) / (1000 * 60 * 60 * 24));

      // 7. Find matching milestones from the company's active schedule
      const eligibleMilestones: string[] = [];

      for (const milestoneId of activeSchedule) {
        const offset = MILESTONE_OFFSETS[milestoneId];
        if (offset === undefined) continue;

        // Matches if diffDays exactly equals offset, or offset - 1 (1-day catchup for weekends / skipped non-dispatch days)
        if (diffDays === offset || diffDays === (offset - 1)) {
          eligibleMilestones.push(milestoneId);
        }
      }

      // Check custom days before
      for (const d of customBefore) {
        if (diffDays === d || diffDays === (d - 1)) {
          eligibleMilestones.push(`custom_before_${d}`);
        }
      }

      // Check custom days after
      for (const d of customAfter) {
        const offset = -d;
        if (diffDays === offset || diffDays === (offset - 1)) {
          eligibleMilestones.push(`custom_after_${d}`);
        }
      }

      if (eligibleMilestones.length === 0) continue;

      for (const reminderType of eligibleMilestones) {
        // Check if milestone was already sent
        if (sentMilestones.has(`${invoice.id}_${reminderType}`)) continue;

        // Check if ANY reminder was sent for this invoice today to avoid spamming
        if (sentTodayInvoices.has(invoice.id)) continue;

        // Customer email validation
        const rawCustomerEmail = 
          invoice.customer?.email_id1 || 
          invoice.customer?.email_id2 || 
          invoice.customer?.email_id3 || 
          invoice.customer?.email || 
          (invoice as any).email ||
          (invoice as any).customer_email ||
          null;

        const customerEmail = rawCustomerEmail && emailRegex.test(rawCustomerEmail.trim())
          ? rawCustomerEmail.trim()
          : null;

        if (!customerEmail) {
          results.push({
            invoiceId: invoice.id,
            invoiceNo: invoice.invoice_no,
            type: reminderType,
            status: 'skipped',
            reason: 'No valid customer email address on file'
          });
          continue; // No email on file
        }

        console.log(`📧 Sending automated ${reminderType} reminder for invoice #${invoice.invoice_no} to ${customerEmail}`);
        
        const emailContent = generateEmailContent(invoice, reminderType, undefined, compConfig?.company);
        const pdfBuffer = await prepareInvoicePDF(invoice);

        const sendResult = await sendEmail(
          customerEmail,
          emailContent.subject,
          emailContent.body,
          [
            {
              filename: `Invoice_${invoice.invoice_no || invoice.id}.pdf`,
              content: pdfBuffer
            }
          ],
          emailContent.html,
          invoice.company_id || companyId || undefined
        );

        if (sendResult.success) {
          sentCount++;
          if (invoice.id && invoice.customer_id) {
            await prisma.emailLog.create({
              data: {
                invoiceId: invoice.id,
                customerId: invoice.customer_id,
                reminderType: reminderType,
                emailSent: new Date(),
                recipientEmail: customerEmail,
                status: 'sent'
              }
            }).catch((e) => console.error('Error logging emailLog:', e));
          }

          sentMilestones.add(`${invoice.id}_${reminderType}`);
          sentTodayInvoices.add(invoice.id);

          results.push({
            invoiceId: invoice.id,
            invoiceNo: invoice.invoice_no,
            type: reminderType,
            status: 'sent',
            recipient: customerEmail
          });
        } else {
          results.push({
            invoiceId: invoice.id,
            invoiceNo: invoice.invoice_no,
            type: reminderType,
            status: 'failed',
            recipient: customerEmail,
            error: sendResult.error
          });
        }
      }
    }
  } catch (err) {
    console.error('Error in runScheduledInvoiceReminders:', err);
  }

  return { sentCount, results };
};


// TEST ROUTE: Send sample email for 8840
export const sendTestEmail8840 = async (req: Request, res: Response) => {
  try {
    const invoice = await prisma.legacyInvoice.findFirst({
      where: { invoice_no: 8840 },
      include: { customer: true }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice 8840 not found' });
    }

    const customerEmail = 
      invoice.customer?.email_id1 || 
      invoice.customer?.email_id2 || 
      invoice.customer?.email || 
      'rdhanushkumarramalingam@gmail.com';

    const pdfBuffer = await prepareInvoicePDF(invoice);
    const emailContent = generateEmailContent(invoice, 'manual');

    const result = await sendEmail(
      customerEmail,
      `[TEST] ${emailContent.subject}`,
      emailContent.body,
      [
        {
          filename: `Invoice_${invoice.invoice_no}.pdf`,
          content: pdfBuffer
        }
      ],
      emailContent.html,
      invoice.company_id || undefined
    );

    res.json({ success: result.success, message: `Test email for 8840 sent to ${customerEmail}`, error: result.error });
  } catch (error: any) {
    console.error('Error in test email:', error);
    res.status(500).json({ error: error.message });
  }
};
