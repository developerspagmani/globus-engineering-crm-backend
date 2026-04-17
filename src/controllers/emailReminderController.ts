import { Request, Response } from 'express';
import prisma from '../config/prisma';
import nodemailer from 'nodemailer';


// GET /api/invoices/:id/reminder-status - Get reminder status for an invoice
export const getReminderStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'Company ID is required' });
    }

    // Check if reminder exists, otherwise return default (enabled: true)
    const reminder = await prisma.invoiceReminder.findUnique({
      where: {
        invoiceId_companyId: {
          invoiceId: parseInt(id),
          companyId: company_id as string
        }
      }
    });

    res.json(reminder || { enabled: true });
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

    if (!company_id || typeof enabled !== 'boolean') {
      return res.status(400).json({ 
        error: 'Company ID and enabled status are required' 
      });
    }

    const reminder = await prisma.invoiceReminder.upsert({
      where: {
        invoiceId_companyId: {
          invoiceId: parseInt(id),
          companyId: company_id
        }
      },
      update: {
        enabled,
        updatedAt: new Date()
      },
      create: {
        invoiceId: parseInt(id),
        companyId: company_id,
        enabled,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      enabled: reminder.enabled,
      message: `Email reminders ${enabled ? 'enabled' : 'disabled'} for invoice ${id}`,
    });
  } catch (error) {
    console.error('Error updating reminder status:', error);
    res.status(500).json({ error: 'Failed to update reminder status' });
  }
};

// GET /api/email-reminder-service - Process and send pending reminders
export const processEmailReminders = async (req: Request, res: Response) => {
  try {
    const { company_id } = req.query;
    
    // If company_id is provided, process only for that company. 
    // If not, process for all companies (internal use).
    
    // Fetch enabled reminders
    const whereClause: any = { enabled: true };
    if (company_id) {
      whereClause.companyId = company_id as string;
    }

    const enabledReminders = await prisma.invoiceReminder.findMany({
      where: whereClause,
      include: {
        invoice: {
          include: {
            customer: true
          }
        }
      }
    });

    let sentCount = 0;
    let skippedCount = 0;
    const results: any[] = [];

    for (const reminder of enabledReminders) {
      const invoice = (reminder as any).invoice;
      if (!invoice || !invoice.dueDate) {
        skippedCount++;
        continue;
      }

      const reminderDates = calculateReminderDates(invoice.dueDate);
      for (const [reminderType, targetDate] of Object.entries(reminderDates)) {
        // Handle urgent reminders (due within 10 days) - send immediately
        if (reminderType === 'urgent' && targetDate && isToday(targetDate)) {
          // Check if already sent today
          const alreadyLog = await prisma.emailLog.findFirst({
            where: {
              invoiceId: reminder.invoiceId,
              reminderType: 'urgent',
              createdAt: {
                gte: new Date(new Date().setHours(0, 0, 0, 0))
              }
            }
          });
          if (alreadyLog) continue;
          
          console.log(`📧 Sending urgent ${reminderType} reminder for invoice ${reminder.invoiceId}`);
          
          const emailContent = generateEmailContent(invoice);
          const customerEmail = `${invoice.customerName?.toLowerCase().replace(/\s+/g, '.')}@example.com`;
          
          const success = await sendEmail(
            customerEmail,
            emailContent.subject,
            emailContent.body
          );

          if (success) {
            sentCount++;
            results.push({
              invoiceId: reminder.invoiceId,
              reminderType,
              status: 'sent',
              timestamp: new Date().toISOString(),
              customerEmail,
            });
          } else {
            failedCount++;
            results.push({
              invoiceId: reminder.invoiceId,
              reminderType,
              status: 'failed',
              timestamp: new Date().toISOString(),
              customerEmail,
              error: 'Email service unavailable',
            });
          }
        } else if (targetDate && isToday(targetDate)) {
          // Send all 4 emails immediately if due date is within 10 days
          console.log(`🚨 Due date within 10 days - sending all 4 emails immediately for invoice ${reminder.invoiceId}`);
          
          for (const [emailType, emailDate] of Object.entries(reminderDates)) {
            if (emailType === 'urgent') continue; // Skip urgent, already handled
            
            const alreadyLog = await prisma.emailLog.findFirst({
              where: {
                invoiceId: reminder.invoiceId,
                reminderType: emailType,
                createdAt: {
                  gte: new Date(new Date().setHours(0, 0, 0, 0))
                }
              }
            });
            
            if (alreadyLog) continue;
            
            console.log(`📧 Sending immediate ${emailType} reminder for invoice ${reminder.invoiceId}`);
            
            const emailContent = generateEmailContent(invoice);
            const customerEmail = `${invoice.customerName?.toLowerCase().replace(/\s+/g, '.')}@example.com`;
            
            const success = await sendEmail(
              customerEmail,
              emailContent.subject,
              emailContent.body
            );

            if (success) {
              sentCount++;
              results.push({
                invoiceId: reminder.invoiceId,
                reminderType: emailType,
                status: 'sent',
                timestamp: new Date().toISOString(),
                customerEmail,
              });
            } else {
              failedCount++;
              results.push({
                invoiceId: reminder.invoiceId,
                reminderType: emailType,
                status: 'failed',
                timestamp: new Date().toISOString(),
                customerEmail,
                error: 'Email service unavailable',
              });
            }
          }
        } else if (targetDate && isToday(targetDate)) {
          results.push({ invoiceId: reminder.invoiceId, type: reminderType, success: true });
        }
      }
    }

    res.json({
      success: true,
      sent: sentCount,
      skipped: skippedCount,
      results
    });
  } catch (error) {
    console.error('Error processing reminders:', error);
    res.status(500).json({ error: 'Failed to process reminders' });
  }
};

function calculateReminderDates(dueDate: string): {
  '30_days': Date;
  '1_week': Date;
  '1_day': Date;
  'today': Date;
  urgent: Date | null;
} {
  if (!dueDate) return null;
  
  const due = new Date(dueDate);
  const today = new Date();
  const daysUntilDue = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  return {
    '30_days': new Date(due.getTime() - (30 * 24 * 60 * 60 * 1000)),
    '1_week': new Date(due.getTime() - (7 * 24 * 60 * 60 * 1000)),
    '1_day': new Date(due.getTime() - (1 * 24 * 60 * 60 * 1000)),
    'today': due,
    'urgent': daysUntilDue <= 10 ? today : null, // Dynamic: send immediately if due within 10 days
  };
}

function isToday(date: Date) {
  const today = new Date();
  return date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
}

function generateEmailContent(invoice: any) {
  return {
    subject: `Payment Reminder - Invoice #${invoice.invoice_no}`,
    body: `
Dear ${invoice.customer_name},

This is a friendly reminder regarding your invoice #${invoice.invoice_no} for the amount of ₹${invoice.grand_total?.toLocaleString() || '0'}.

Delivery Details:
- DC No: ${invoice.dc_no || 'N/A'}
- DC Date: ${invoice.dc_date ? new Date(invoice.dc_date).toLocaleDateString() : 'N/A'}

Please ensure payment is made at your earliest convenience. If you have already paid, please ignore this email.

Best regards,
Globus Engineering Team
    `.trim()
  };
}

async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from: `"${process.env.FROM_NAME || 'Globus Engineering'}" <${process.env.FROM_EMAIL || 'noreply@globusengineering.com'}>`,
      to,
      subject,
      text: body,
    });
    return true;
  } catch (error) {
    console.error('Nodemailer error:', error);
    return false;
  }
}

