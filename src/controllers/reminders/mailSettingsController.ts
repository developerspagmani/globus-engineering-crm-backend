import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import nodemailer from 'nodemailer';
import { cachedTransporter } from './reminderCommon';
import { runScheduledInvoiceReminders } from './invoiceReminderController';
import { processLeadVisitReminders } from './leadReminderController';

// GET /api/settings/mail - Get company or system SMTP mail configuration
export const getMailSettings = async (req: Request, res: Response) => {
  try {
    const { company_id } = req.query;

    let smtpConfig: any = null;

    if (company_id && typeof company_id === 'string') {
      const company = await prisma.company.findUnique({
        where: { id: company_id }
      });
      if (company?.invoice_settings) {
        try {
          const parsed = JSON.parse(company.invoice_settings);
          smtpConfig = parsed.smtp || null;
        } catch (e) {
          smtpConfig = null;
        }
      }
    }

    // Fall back to first company with SMTP configuration if not specified
    if (!smtpConfig) {
      try {
        const firstConfigured = await prisma.company.findFirst({
          where: { invoice_settings: { contains: '"smtp"' } }
        });
        if (firstConfigured?.invoice_settings) {
          const parsed = JSON.parse(firstConfigured.invoice_settings);
          smtpConfig = parsed.smtp || null;
        }
      } catch (e) {}
    }

    const host = smtpConfig?.host || process.env.SMTP_HOST || '';
    const port = smtpConfig?.port || parseInt(process.env.SMTP_PORT || '587');
    const user = smtpConfig?.user || process.env.SMTP_USER || '';
    const pass = smtpConfig?.pass || process.env.SMTP_PASS || '';
    const secure = smtpConfig?.secure !== undefined ? smtpConfig.secure : (port === 465);
    const fromName = smtpConfig?.fromName || process.env.FROM_NAME || 'Globus Engineering';
    const fromEmail = smtpConfig?.fromEmail || process.env.FROM_EMAIL || user || '';
    const replyTo = smtpConfig?.replyTo || '';
    const ccEmail = smtpConfig?.ccEmail || '';
    const enableAutoReminders = smtpConfig?.enableAutoReminders !== undefined ? smtpConfig.enableAutoReminders : true;
    const reminderSchedule = smtpConfig?.reminderSchedule || [
      '30_days', '1_week', '1_day', 'today', 'overdue_7_days', 'overdue_15_days'
    ];
    const enableLeadReminders = smtpConfig?.enableLeadReminders !== undefined ? smtpConfig.enableLeadReminders : true;
    const leadReminderDays = smtpConfig?.leadReminderDays !== undefined ? Math.max(1, parseInt(smtpConfig.leadReminderDays) || 1) : 1;
    const reminderExecutionTime = smtpConfig?.reminderExecutionTime || '10:00';
    const enableSecondaryTime = smtpConfig?.enableSecondaryTime !== undefined ? smtpConfig.enableSecondaryTime : true;
    const secondaryExecutionTime = smtpConfig?.secondaryExecutionTime || '12:40';
    const reminderDaysOfWeek = smtpConfig?.reminderDaysOfWeek || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const leadSameDayAlert = smtpConfig?.leadSameDayAlert !== undefined ? smtpConfig.leadSameDayAlert : true;
    const customReminderDaysBefore = smtpConfig?.customReminderDaysBefore || '';
    const customReminderDaysAfter = smtpConfig?.customReminderDaysAfter || '';
    const lastRunTimestamp = smtpConfig?.lastRunTimestamp || null;
    const lastRunStats = smtpConfig?.lastRunStats || null;

    res.json({
      success: true,
      smtpHost: host,
      smtpPort: port,
      smtpUser: user,
      smtpPass: pass ? '••••••••' : '',
      hasPassword: !!pass,
      secure: secure,
      fromName: fromName,
      fromEmail: fromEmail,
      replyTo: replyTo,
      ccEmail: ccEmail,
      enableAutoReminders: enableAutoReminders,
      reminderSchedule: reminderSchedule,
      enableLeadReminders: enableLeadReminders,
      leadReminderDays: leadReminderDays,
      reminderExecutionTime: reminderExecutionTime,
      enableSecondaryTime: enableSecondaryTime,
      secondaryExecutionTime: secondaryExecutionTime,
      reminderDaysOfWeek: reminderDaysOfWeek,
      leadSameDayAlert: leadSameDayAlert,
      customReminderDaysBefore: customReminderDaysBefore,
      customReminderDaysAfter: customReminderDaysAfter,
      lastRunTimestamp: lastRunTimestamp,
      lastRunStats: lastRunStats,
      isConfigured: !!(host && user && pass),
      source: smtpConfig ? 'company' : (process.env.SMTP_HOST ? 'env' : 'unconfigured')
    });
  } catch (error: any) {
    console.error('Error fetching mail settings:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch mail settings' });
  }
};

// PUT /api/settings/mail - Save SMTP & mail configuration for a company
export const updateMailSettings = async (req: Request, res: Response) => {
  try {
    const { 
      company_id, 
      smtpHost, 
      smtpPort, 
      smtpUser, 
      smtpPass, 
      secure, 
      fromName, 
      fromEmail, 
      replyTo, 
      ccEmail, 
      enableAutoReminders, 
      reminderSchedule,
      enableLeadReminders,
      leadReminderDays,
      reminderExecutionTime,
      enableSecondaryTime,
      secondaryExecutionTime,
      reminderDaysOfWeek,
      leadSameDayAlert,
      customReminderDaysBefore,
      customReminderDaysAfter
    } = req.body;

    if (!company_id || typeof company_id !== 'string') {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    const company = await prisma.company.findUnique({
      where: { id: company_id }
    });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    let existingSettings: any = {};
    if (company.invoice_settings) {
      try {
        existingSettings = JSON.parse(company.invoice_settings) || {};
      } catch (e) {
        existingSettings = {};
      }
    }

    const existingSmtp = existingSettings.smtp || {};

    // Keep old password if mask '••••••••' or empty string was submitted
    let finalPass = smtpPass;
    if (!finalPass || finalPass === '••••••••' || finalPass === '********') {
      finalPass = existingSmtp.pass || process.env.SMTP_PASS || '';
    }

    const updatedSmtp = {
      host: (smtpHost || '').trim(),
      port: parseInt(smtpPort) || 587,
      user: (smtpUser || '').trim(),
      pass: finalPass,
      secure: secure === true || parseInt(smtpPort) === 465,
      fromName: (fromName || '').trim(),
      fromEmail: (fromEmail || '').trim(),
      replyTo: (replyTo || '').trim(),
      ccEmail: (ccEmail || '').trim(),
      enableAutoReminders: enableAutoReminders !== false,
      reminderSchedule: Array.isArray(reminderSchedule) ? reminderSchedule : existingSmtp.reminderSchedule || [],
      enableLeadReminders: enableLeadReminders !== undefined ? enableLeadReminders === true : (existingSmtp.enableLeadReminders !== false),
      leadReminderDays: leadReminderDays !== undefined ? Math.max(1, parseInt(leadReminderDays) || 1) : (existingSmtp.leadReminderDays || 1),
      reminderExecutionTime: reminderExecutionTime ? String(reminderExecutionTime).trim() : (existingSmtp.reminderExecutionTime || '10:00'),
      enableSecondaryTime: enableSecondaryTime !== undefined ? enableSecondaryTime === true : (existingSmtp.enableSecondaryTime !== false),
      secondaryExecutionTime: secondaryExecutionTime ? String(secondaryExecutionTime).trim() : (existingSmtp.secondaryExecutionTime || '12:40'),
      reminderDaysOfWeek: Array.isArray(reminderDaysOfWeek) ? reminderDaysOfWeek : (existingSmtp.reminderDaysOfWeek || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']),
      leadSameDayAlert: leadSameDayAlert !== undefined ? leadSameDayAlert === true : (existingSmtp.leadSameDayAlert !== false),
      customReminderDaysBefore: customReminderDaysBefore !== undefined ? String(customReminderDaysBefore).trim() : (existingSmtp.customReminderDaysBefore || ''),
      customReminderDaysAfter: customReminderDaysAfter !== undefined ? String(customReminderDaysAfter).trim() : (existingSmtp.customReminderDaysAfter || ''),
      lastRunTimestamp: existingSmtp.lastRunTimestamp || null,
      lastRunStats: existingSmtp.lastRunStats || null,
      updatedAt: new Date().toISOString()
    };

    existingSettings.smtp = updatedSmtp;

    await prisma.company.update({
      where: { id: company_id },
      data: {
        invoice_settings: JSON.stringify(existingSettings)
      }
    });

    res.json({
      success: true,
      message: 'SMTP and Mail configuration updated successfully',
      settings: {
        smtpHost: updatedSmtp.host,
        smtpPort: updatedSmtp.port,
        smtpUser: updatedSmtp.user,
        hasPassword: !!updatedSmtp.pass,
        secure: updatedSmtp.secure,
        fromName: updatedSmtp.fromName,
        fromEmail: updatedSmtp.fromEmail,
        replyTo: updatedSmtp.replyTo,
        ccEmail: updatedSmtp.ccEmail,
        enableAutoReminders: updatedSmtp.enableAutoReminders,
        reminderSchedule: updatedSmtp.reminderSchedule,
        enableLeadReminders: updatedSmtp.enableLeadReminders,
        leadReminderDays: updatedSmtp.leadReminderDays,
        reminderExecutionTime: updatedSmtp.reminderExecutionTime,
        enableSecondaryTime: updatedSmtp.enableSecondaryTime,
        secondaryExecutionTime: updatedSmtp.secondaryExecutionTime,
        reminderDaysOfWeek: updatedSmtp.reminderDaysOfWeek,
        leadSameDayAlert: updatedSmtp.leadSameDayAlert,
        customReminderDaysBefore: updatedSmtp.customReminderDaysBefore,
        customReminderDaysAfter: updatedSmtp.customReminderDaysAfter,
        lastRunTimestamp: updatedSmtp.lastRunTimestamp,
        lastRunStats: updatedSmtp.lastRunStats,
        isConfigured: !!(updatedSmtp.host && updatedSmtp.user && updatedSmtp.pass)
      }
    });
  } catch (error: any) {
    console.error('Error updating mail settings:', error);
    res.status(500).json({ error: error.message || 'Failed to update mail settings' });
  }
};

// POST /api/settings/mail/run-reminders - Immediately trigger automated reminder sweep on demand
export const triggerManualReminders = async (req: Request, res: Response) => {
  try {
    const { company_id } = req.body;
    const { sentCount, results } = await runScheduledInvoiceReminders(company_id as string | undefined);
    const leadSentCount = await processLeadVisitReminders(company_id as string | undefined);

    const stats = {
      totalSent: sentCount + leadSentCount,
      invoicesSent: sentCount,
      leadRemindersSent: leadSentCount
    };

    if (company_id) {
      try {
        const company = await prisma.company.findUnique({ where: { id: company_id } });
        if (company?.invoice_settings) {
          const parsed = JSON.parse(company.invoice_settings);
          if (parsed?.smtp) {
            parsed.smtp.lastRunTimestamp = new Date().toISOString();
            parsed.smtp.lastRunStats = stats;
            await prisma.company.update({
              where: { id: company_id },
              data: { invoice_settings: JSON.stringify(parsed) }
            });
          }
        }
      } catch (e) {
        console.error('Failed to update lastRunStats in company:', e);
      }
    }

    const message = (sentCount > 0 || leadSentCount > 0)
      ? `Triggered reminder sweep: ${sentCount} invoice reminder(s) and ${leadSentCount} lead reminder(s) processed.`
      : `Reminder check completed: No pending invoices or leads matched today's active reminder milestones, or emails have already been dispatched today.`;

    res.json({
      success: true,
      message,
      ...stats,
      details: results,
      lastRunTimestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error in triggerManualReminders:', error);
    res.status(500).json({ error: error.message || 'Failed to trigger reminders' });
  }
};

// POST /api/settings/mail/test - Test SMTP connection & send test email
export const testMailSettings = async (req: Request, res: Response) => {
  try {
    const { 
      company_id, 
      testEmail, 
      smtpHost, 
      smtpPort, 
      smtpUser, 
      smtpPass, 
      secure, 
      fromName, 
      fromEmail 
    } = req.body;

    if (!testEmail || typeof testEmail !== 'string') {
      return res.status(400).json({ error: 'Recipient test email address is required' });
    }

    let host = smtpHost?.trim();
    let port = parseInt(smtpPort);
    let user = smtpUser?.trim();
    let pass = smtpPass;
    let isSecure = secure;
    let senderName = fromName?.trim();
    let senderEmail = fromEmail?.trim();

    // Check company settings if not provided in request body
    if (!host && company_id) {
      const company = await prisma.company.findUnique({ where: { id: company_id } });
      if (company?.invoice_settings) {
        try {
          const parsed = JSON.parse(company.invoice_settings);
          if (parsed.smtp) {
            host = parsed.smtp.host;
            port = parsed.smtp.port;
            user = parsed.smtp.user;
            pass = parsed.smtp.pass;
            isSecure = parsed.smtp.secure;
            senderName = parsed.smtp.fromName;
            senderEmail = parsed.smtp.fromEmail;
          }
        } catch (e) {}
      }
    }

    // Fall back to .env
    host = host || process.env.SMTP_HOST;
    port = port || parseInt(process.env.SMTP_PORT || '587');
    user = user || process.env.SMTP_USER;
    if (!pass || pass === '••••••••') pass = process.env.SMTP_PASS;
    if (isSecure === undefined) isSecure = port === 465;
    senderName = senderName || process.env.FROM_NAME || 'Globus Engineering';
    senderEmail = senderEmail || process.env.FROM_EMAIL || user;

    if (!host || !user || !pass) {
      return res.status(400).json({ 
        error: 'Incomplete SMTP credentials. Host, Port, Username, and Password are required.' 
      });
    }

    const testTransporter = nodemailer.createTransport({
      host,
      port,
      secure: isSecure === true || port === 465,
      auth: {
        user,
        pass
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // Verify SMTP connection
    await testTransporter.verify();

    // Send a real test email
    const info = await testTransporter.sendMail({
      from: `"${senderName}" <${senderEmail || user}>`,
      to: testEmail,
      subject: `[Diagnostic Test] SMTP Configuration Test - ${senderName}`,
      text: `Hello,\n\nThis is a confirmation that your SMTP Mail server settings for "${senderName}" (${host}:${port}) are properly configured and functioning.\n\nAutomated payment reminders and lead visit alerts can now be dispatched successfully.\n\nTimestamp: ${new Date().toISOString()}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h3 style="color: #15803d; margin-top: 0;">&#10004; SMTP Connection Successful</h3>
          <p>Your SMTP mail configuration for <strong>${senderName}</strong> is verified and working properly.</p>
          <div style="background-color: #f8fafc; padding: 12px 16px; border-radius: 6px; font-size: 13px; color: #475569; margin: 16px 0;">
            <div><strong>Host:</strong> ${host}</div>
            <div><strong>Port:</strong> ${port} (${isSecure ? 'SSL/TLS' : 'STARTTLS'})</div>
            <div><strong>User:</strong> ${user}</div>
            <div><strong>From:</strong> ${senderName} &lt;${senderEmail || user}&gt;</div>
            <div><strong>Tested At:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</div>
          </div>
          <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">Automated invoice payment reminders and lead visit alerts will be dispatched using these credentials.</p>
        </div>
      `
    });

    res.json({
      success: true,
      message: `SMTP connection verified and diagnostic email sent to ${testEmail}!`,
      messageId: info.messageId,
      host,
      port,
      user
    });
  } catch (error: any) {
    console.error('SMTP test connection failed:', error);
    res.status(500).json({ 
      error: error.message || 'SMTP connection verification failed. Please check your credentials and port.' 
    });
  }
};
