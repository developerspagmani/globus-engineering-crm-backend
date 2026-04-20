import { Request, Response } from 'express';
import prisma from '../config/prisma';
import nodemailer from 'nodemailer';
import { generateInvoicePDF } from '../utils/pdfGenerator';


// GET /api/invoices/:id/reminder-status - Get reminder status for an invoice
export const getReminderStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id || typeof company_id !== 'string') {
      return res.status(400).json({ error: 'Company ID is required and must be a string' });
    }

    // Check if reminder exists, otherwise return default (enabled: true)
    const reminder = await prisma.invoiceReminder.findUnique({
      where: {
        invoiceId_companyId: {
          invoiceId: parseInt(id as string),
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

    if (!company_id || typeof company_id !== 'string' || typeof enabled !== 'boolean') {
      return res.status(400).json({ 
        error: 'Company ID (string) and enabled status (boolean) are required' 
      });
    }

    const reminder = await prisma.invoiceReminder.upsert({
      where: {
        invoiceId_companyId: {
          invoiceId: parseInt(id as string),
          companyId: company_id
        }
      },
      update: {
        enabled,
        updatedAt: new Date()
      },
      create: {
        invoiceId: parseInt(id as string),
        companyId: company_id as string,
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
    
    // 1. Fetch all invoices
    const whereInvoice: any = {};
    if (company_id && typeof company_id === 'string') {
      whereInvoice.company_id = company_id;
    }

    const invoices = await prisma.legacyInvoice.findMany({
      where: whereInvoice,
      include: {
        reminders: true,
        customer: true
      }
    });

    // 1.1 Fetch Inward Entry due dates for invoices that don't have one
    const inwardIds = invoices
      .filter(inv => !inv.due_date && inv.inward_id)
      .map(inv => inv.inward_id as string);
    
    const inwards = await prisma.inwardEntry.findMany({
      where: { id: { in: inwardIds } },
      select: {
        id: true,
        due_date: true
      }
    });
    
    const inwardDueDateMap = new Map(inwards.map(i => [
      i.id, 
      (i as any).due_date
    ]));

    let sentCount = 0;
    const results: any[] = [];
    const processedInvoiceNos = new Set<string>();

    for (const invoice of invoices) {
      // 2. Determine the effective due date (Invoice date or Inward date)
      let effectiveDueDate = invoice.due_date;
      if (!effectiveDueDate && invoice.inward_id) {
        effectiveDueDate = inwardDueDateMap.get(invoice.inward_id) || null;
      }

      if (!effectiveDueDate || !invoice.invoice_no) continue;

      // 3. Deduplicate: Skip if we already processed this invoice number in this run
      const dupKey = `${invoice.invoice_no}_${invoice.customer_id}`;
      if (processedInvoiceNos.has(dupKey)) continue;
      processedInvoiceNos.add(dupKey);
      
      // 4. Check if reminders are explicitly disabled for this invoice
      const reminderSetting = invoice.reminders.find(r => r.companyId === invoice.company_id);
      if (reminderSetting && reminderSetting.enabled === false) {
        continue; // Skip if manually disabled
      }

      const reminderDates = calculateReminderDates(effectiveDueDate);
      if (!reminderDates) continue;

      // 3. Loop through each scheduled reminder type
      for (const [reminderType, targetDate] of Object.entries(reminderDates)) {
        if (!targetDate) continue;

        const isUrgent = reminderType === 'urgent';
        const isScheduledForToday = isToday(targetDate);
        const isPastDue = targetDate < new Date() && !isToday(targetDate);

        if (isScheduledForToday) {
          // 4. Check if we already sent THIS specific milestone ever
          const milestoneAlreadySent = await prisma.emailLog.findFirst({
            where: {
              invoiceId: invoice.id,
              reminderType: reminderType
            }
          });

          if (milestoneAlreadySent) continue;

          // 5. Check if we already sent ANY reminder for this invoice TODAY
          // (To prevent sending 'today' and 'urgent' on the same day)
          const anySentToday = await prisma.emailLog.findFirst({
            where: {
              invoiceId: invoice.id,
              createdAt: {
                gte: new Date(new Date().setHours(0, 0, 0, 0))
              }
            }
          });

          if (anySentToday) continue;

          console.log(`📧 Sending ${reminderType} reminder for invoice ${invoice.invoice_no}`);
          
          const emailContent = generateEmailContent(invoice);
          
          // Get reach email from customer record
          const customerEmail = invoice.customer?.email_id1 || 
                               invoice.customer?.email_id2 || 
                               invoice.customer?.email || 
                               (invoice.customer_name ? `${invoice.customer_name.toLowerCase().replace(/\s+/g, '.')}@gmail.com` : null);
          
          if (!customerEmail) continue;
          
          const pdfBuffer = await generateInvoicePDF({
            invoiceNumber: invoice.invoice_no?.toString() || 'N/A',
            invoiceDate: invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : 'N/A',
            dcNo: invoice.dc_no || 'N/A',
            dcDate: invoice.dc_date ? new Date(invoice.dc_date).toLocaleDateString() : 'N/A',
            poNo: invoice.po_no || 'N/A',
            poDate: invoice.po_date ? new Date(invoice.po_date).toLocaleDateString() : 'N/A',
            customerName: invoice.customer_name || 'N/A',
            customerAddress: invoice.address || invoice.customer?.street1 || 'N/A',
            customerGst: invoice.customer?.gst || 'N/A',
            items: JSON.parse(invoice.items_json || '[]').map((it: any) => ({
              description: it.description || 'N/A',
              quantity: it.quantity || 0,
              price: it.unitPrice || 0,
              amount: it.total || 0
            })),
            subTotal: parseFloat(invoice.total || '0'),
            taxTotal: parseFloat(invoice.tax_total || '0'),
            grandTotal: parseFloat(invoice.grand_total || '0'),
            companyName: 'Globus Engineering Tools',
            companyAddress: 'No:24, Annaiyappan Street, S.S.Nagar, Nallampalayam, Coimbatore - 641006',
            companyGst: '33AAIFG6568K1ZZ',
            bankDetails: {
              bankName: 'INDIAN OVERSEAS BANK',
              accNo: '170902000000962',
              ifsc: 'IOBA0001709'
            }
          });

          const success = await sendEmail(
            customerEmail,
            emailContent.subject,
            emailContent.body,
            [
              {
                filename: `Invoice_${invoice.invoice_no}.pdf`,
                content: pdfBuffer
              }
            ]
          );

          if (success) {
            sentCount++;
            await prisma.emailLog.create({
              data: {
                invoiceId: invoice.id,
                customerId: invoice.customer_id || 0,
                reminderType: reminderType,
                emailSent: new Date(),
                recipientEmail: customerEmail,
                status: 'sent'
              }
            });

            results.push({
              invoiceId: invoice.id,
              type: reminderType,
              status: 'sent'
            });
          }
        }
      }
    }

    res.json({
      success: true,
      totalSent: sentCount,
      details: results
    });
  } catch (error: any) {
    console.error('Error processing reminders:', error);
    res.status(500).json({ error: 'Failed to process reminders', detail: error.message });
  }
};

function calculateReminderDates(dueDate: Date): {
  '30_days': Date;
  '1_week': Date;
  '1_day': Date;
  'today': Date;
  urgent: Date | null;
} | null {
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

Please find the attached invoice #${invoice.invoice_no} for your reference. 

Please ensure payment is made at your earliest convenience. If you have already paid, please ignore this email.

Best regards,
Globus Engineering Team
    `.trim()
  };
}

async function sendEmail(to: string, subject: string, body: string, attachments?: any[]): Promise<boolean> {
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
      attachments
    });
    return true;
  } catch (error) {
    console.error('Nodemailer error:', error);
    return false;
  }
}


export const sendTestEmail8840 = async (req: Request, res: Response) => {
  try {
    console.log('🚀 Starting test email for 8840...');
    const invoice = await prisma.legacyInvoice.findFirst({
      where: { invoice_no: 8840 },
      include: { customer: true }
    });

    if (!invoice) {
        console.log('❌ Invoice 8840 not found');
        return res.status(404).json({ error: 'Invoice 8840 not found' });
    }
    console.log('✅ Found invoice 8840');

    const customerEmail = invoice.customer?.email_id1 || 
                         invoice.customer?.email_id2 || 
                         invoice.customer?.email || 
                         'rdhanushkumarramalingam@gmail.com';

    console.log(`📧 Recipient: ${customerEmail}`);
    const emailContent = generateEmailContent(invoice);
    
    console.log('📄 Generating PDF...');
    const pdfBuffer = await generateInvoicePDF({
      invoiceNumber: invoice.invoice_no?.toString() || 'N/A',
      invoiceDate: invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : 'N/A',
      dcNo: invoice.dc_no || 'N/A',
      dcDate: invoice.dc_date ? new Date(invoice.dc_date).toLocaleDateString() : 'N/A',
      poNo: invoice.po_no || 'N/A',
      poDate: invoice.po_date ? new Date(invoice.po_date).toLocaleDateString() : 'N/A',
      customerName: invoice.customer_name || 'N/A',
      customerAddress: invoice.address || invoice.customer?.street1 || 'N/A',
      customerGst: invoice.customer?.gst || 'N/A',
      items: JSON.parse(invoice.items_json || '[]').map((it: any) => ({
        description: it.description || 'N/A',
        quantity: it.quantity || 0,
        price: it.unitPrice || 0,
        amount: it.total || 0,
        hsn: it.hsn || '84661010'
      })),
      subTotal: parseFloat(invoice.total || '0'),
      taxTotal: parseFloat(invoice.tax_total || '0'),
      grandTotal: parseFloat(invoice.grand_total || '0'),
      companyName: 'Globus Engineering Tools',
      companyAddress: 'No:24, Annaiyappan Street, S.S.Nagar, Nallampalayam, Coimbatore - 641006',
      companyGst: '33AAIFG6568K1ZZ',
      bankDetails: {
        bankName: 'INDIAN OVERSEAS BANK',
        accNo: '170902000000962',
        ifsc: 'IOBA0001709'
      }
    });
    console.log('✅ PDF Generated');

    console.log('📨 Sending Email via SMTP...');
    const success = await sendEmail(
      customerEmail,
      `[SAMPLE] ${emailContent.subject}`,
      emailContent.body,
      [
        {
          filename: `Invoice_${invoice.invoice_no}.pdf`,
          content: pdfBuffer
        }
      ]
    );

    console.log(`🏁 Result: ${success ? 'SUCCESS' : 'FAILURE'}`);
    res.json({ success, message: `Sample email for 8840 sent to ${customerEmail}` });
  } catch (error: any) {
    console.error('💥 Error in test email:', error);
    res.status(500).json({ error: error.message });
  }
};
