import { Request, Response } from 'express';
import prisma from '../config/prisma';
import nodemailer from 'nodemailer';
import { generateInvoicePDF } from '../utils/pdfGenerator';
import { getCompanyTransporter } from '../utils/email';

const cleanStr = (val: any): string => {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (str.toLowerCase() === 'null') return '';
  return str;
};

// Cached nodemailer transporter
let cachedTransporter: nodemailer.Transporter | null = null;

async function getTransporter(companyId?: string | null): Promise<nodemailer.Transporter | null> {
  const { transporter } = await getCompanyTransporter(companyId);
  return transporter;
}

/**
 * Format currency in Indian Rupees
 */
const formatINR = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
};

/**
 * Prepare dynamic invoice PDF Buffer
 */
async function prepareInvoicePDF(invoice: any): Promise<Buffer> {
  const resolvedCustomerName = cleanStr(invoice.customer_name) || cleanStr(invoice.customer?.customer_name) || 'Customer';
  
  let resolvedCustomerAddress = cleanStr(invoice.address);
  if (!resolvedCustomerAddress && invoice.customer) {
    const parts = [
      cleanStr(invoice.customer.street1),
      cleanStr(invoice.customer.street2),
      cleanStr(invoice.customer.city),
      cleanStr(invoice.customer.state)
    ].filter(Boolean);
    if (invoice.customer.pin_code && String(invoice.customer.pin_code).toLowerCase() !== 'null') {
      parts.push(String(invoice.customer.pin_code));
    }
    resolvedCustomerAddress = parts.join(', ');
  }
  if (!resolvedCustomerAddress) resolvedCustomerAddress = 'N/A';

  const resolvedCustomerGst = cleanStr(invoice.gstin) || cleanStr(invoice.customer?.gst) || 'N/A';
  const resolvedState = cleanStr(invoice.state) || cleanStr(invoice.customer?.state) || 'Tamilnadu';

  // Fetch company details dynamically based on invoice.company_id
  let companyObj = null;
  if (invoice.company_id) {
    companyObj = await prisma.company.findUnique({
      where: { id: invoice.company_id }
    });
  }

  // Parse company settings JSON for declaration settings
  let showDeclaration = true;
  let declarationText = undefined;
  if (companyObj && companyObj.invoice_settings) {
    try {
      const parsedSettings = JSON.parse(companyObj.invoice_settings);
      if (parsedSettings.showDeclaration !== undefined) {
        showDeclaration = parsedSettings.showDeclaration;
      }
      if (parsedSettings.declarationText) {
        declarationText = parsedSettings.declarationText;
      }
    } catch (err) {
      console.error('Error parsing company invoice_settings:', err);
    }
  }

  let itemsList: any[] = [];
  try {
    itemsList = typeof invoice.items_json === 'string' ? JSON.parse(invoice.items_json || '[]') : (invoice.items_json || []);
  } catch {
    itemsList = [];
  }

  return await generateInvoicePDF({
    invoiceNumber: invoice.invoice_no ? String(invoice.invoice_no).padStart(4, '0') : (invoice.id?.toString() || 'N/A'),
    invoiceDate: invoice.invoice_date ? new Date(invoice.invoice_date).toISOString() : 'N/A',
    dcNo: invoice.dc_no || 'N/A',
    dcDate: invoice.dc_date ? new Date(invoice.dc_date).toISOString() : 'N/A',
    poNo: invoice.po_no || 'N/A',
    poDate: invoice.po_date ? new Date(invoice.po_date).toISOString() : 'N/A',
    customerName: resolvedCustomerName,
    customerAddress: resolvedCustomerAddress,
    customerGst: resolvedCustomerGst,
    items: itemsList.map((it: any) => ({
      description: it.description || 'N/A',
      quantity: Number(it.qty !== undefined ? it.qty : (it.quantity || 0)),
      price: Number(it.price !== undefined ? it.price : (it.unitPrice || 0)),
      amount: Number(it.item_total !== undefined ? it.item_total : (it.amount || 0)),
      hsn: it.hsnCode || it.hsn || '84661010'
    })),
    subTotal: parseFloat(invoice.total || invoice.sub_total || '0'),
    taxTotal: invoice.tax_total !== null && invoice.tax_total !== undefined 
      ? Number(invoice.tax_total) 
      : (parseFloat(invoice.grand_total || '0') - parseFloat(invoice.total || invoice.sub_total || '0')),
    grandTotal: parseFloat(invoice.grand_total || '0'),
    companyName: companyObj?.company_name || 'Globus Engineering Tools',
    companySubHeader: companyObj?.company_sub_header || 'An ISO 9001: 2015 Certified Company',
    companyAddress: companyObj?.company_address || 'No 24,Annaiyappan Street,S.S.Nagar, Nallampalayam,Ganapathy Post, Coimbatore-641006.',
    companyGst: companyObj?.gst_no || '33AAIFG6568K1ZZ',
    vatTin: companyObj?.vat_tin || '33132028969',
    cstNo: companyObj?.cst_no || '1091562',
    panNo: companyObj?.pan_no || 'AAIFG6568K',
    bankName: companyObj?.bank_name || 'INDIAN OVERSEAS BANK',
    bankAcc: companyObj?.bank_acc || '170902000000962',
    bankBranchIfsc: companyObj?.bank_branch_ifsc || 'IOBA0001709',
    showDeclaration: showDeclaration,
    declarationText: declarationText,
    logo: companyObj?.logo || undefined,
    logoSecondary: companyObj?.logo_secondary || undefined,
    taxRate: Number(invoice.tax_rate || 18),
    state: resolvedState,
    billType: invoice.bill_type || 'with_process'
  });
}

/**
 * Generate rich email subject, plain text body, and responsive HTML body
 */
function generateEmailContent(invoice: any, reminderType: string = 'standard', customNote?: string) {
  const rawCustomerName = String(invoice.customer_name || invoice.customer?.customer_name || '').trim();
  const displayCustomerName = (!rawCustomerName || rawCustomerName.toLowerCase() === 'null') ? 'Valued Customer' : rawCustomerName;
  const invoiceNumber = invoice.invoice_no ? String(invoice.invoice_no).padStart(4, '0') : invoice.id;
  const grandTotal = parseFloat(invoice.grand_total || '0');
  const paidAmount = parseFloat(invoice.paid_amount || '0');
  const balanceDue = Math.max(0, grandTotal - paidAmount);
  const formattedBalance = formatINR(balanceDue > 0 ? balanceDue : grandTotal);
  
  const invoiceDateStr = invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString('en-GB') : 'N/A';
  const dueDateStr = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-GB') : 'Immediate';
  const dcInfo = invoice.dc_no ? `${invoice.dc_no} ${invoice.dc_date ? `(${new Date(invoice.dc_date).toLocaleDateString('en-GB')})` : ''}` : 'N/A';

  let subjectTypePrefix = 'Payment Reminder';
  if (reminderType === 'urgent' || reminderType.includes('overdue')) {
    subjectTypePrefix = 'URGENT: Payment Overdue Notice';
  } else if (reminderType === '1_day' || reminderType === 'today') {
    subjectTypePrefix = 'Action Required: Payment Due Today';
  } else if (reminderType === 'manual') {
    subjectTypePrefix = `Invoice #${invoiceNumber} & Payment Reminder`;
  }

  const subject = `${subjectTypePrefix} - Invoice #${invoiceNumber} - Globus Engineering`;

  const plainTextBody = `
Dear ${displayCustomerName},

This is a payment reminder regarding Invoice #${invoiceNumber} for the outstanding balance of ${formattedBalance}.

Invoice Details:
- Invoice No: #${invoiceNumber}
- Invoice Date: ${invoiceDateStr}
- Due Date: ${dueDateStr}
- DC / Challan No: ${dcInfo}
- Total Amount: ${formatINR(grandTotal)}
- Balance Due: ${formattedBalance}

${customNote ? `Note: ${customNote}\n\n` : ''}Please find the official copy of Invoice #${invoiceNumber} attached as a PDF for your accounting records.

Kindly arrange for the payment at your earliest convenience. If you have already processed the payment, please accept our thanks and disregard this reminder.

For bank transfer details or queries, please feel free to reach out to us.

Best regards,
Accounts Department
Globus Engineering Tools
Coimbatore - 641006
  `.trim();

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #1e3a8a, #2563eb); color: #ffffff; padding: 28px 24px; }
    .header h2 { margin: 0 0 6px 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { margin: 0; opacity: 0.9; font-size: 14px; }
    .content { padding: 28px 24px; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 16px; }
    .amount-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 18px; text-align: center; margin: 20px 0; }
    .amount-label { font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #166534; font-weight: 600; }
    .amount-value { font-size: 30px; font-weight: 800; color: #15803d; margin: 4px 0 0 0; }
    .table-details { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
    .table-details td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
    .table-details td.label { color: #64748b; font-weight: 500; width: 40%; }
    .table-details td.value { color: #0f172a; font-weight: 600; }
    .custom-note { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px; margin: 18px 0; border-radius: 4px; font-size: 14px; color: #92400e; }
    .attachment-notice { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 14px; font-size: 13px; color: #475569; display: flex; align-items: center; margin: 20px 0; }
    .footer { background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2>Globus Engineering Tools</h2>
      <p>${subjectTypePrefix} &bull; Invoice #${invoiceNumber}</p>
    </div>
    <div class="content">
      <div class="greeting">Dear ${displayCustomerName},</div>
      <p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">
        This is a friendly reminder regarding your outstanding invoice with Globus Engineering. Please find the summary below:
      </p>

      <div class="amount-box">
        <div class="amount-label">Outstanding Balance Due</div>
        <div class="amount-value">${formattedBalance}</div>
      </div>

      <table class="table-details">
        <tr>
          <td class="label">Invoice Number</td>
          <td class="value">#${invoiceNumber}</td>
        </tr>
        <tr>
          <td class="label">Invoice Date</td>
          <td class="value">${invoiceDateStr}</td>
        </tr>
        <tr>
          <td class="label">Due Date</td>
          <td class="value">${dueDateStr}</td>
        </tr>
        <tr>
          <td class="label">Challan / DC No</td>
          <td class="value">${dcInfo}</td>
        </tr>
        <tr>
          <td class="label">Total Invoice Value</td>
          <td class="value">${formatINR(grandTotal)}</td>
        </tr>
      </table>

      ${customNote ? `<div class="custom-note"><strong>Note:</strong> ${customNote}</div>` : ''}

      <div class="attachment-notice">
        <span>📎 <strong>Attached:</strong> Complete invoice PDF (Invoice_${invoiceNumber}.pdf) for your accounting verification.</span>
      </div>

      <p style="font-size: 13px; line-height: 1.6; color: #64748b; margin: 16px 0 0 0;">
        Kindly arrange payment at your earliest convenience. If payment has already been remitted, please accept our thanks and disregard this notice.
      </p>
    </div>
    <div class="footer">
      <strong>Globus Engineering Tools</strong><br>
      No 24, Annaiyappan Street, S.S. Nagar, Nallampalayam, Ganapathy Post, Coimbatore - 641006.<br>
      GST: 33AAIFG6568K1ZZ &bull; Contact: accounts@globusengineering.com
    </div>
  </div>
</body>
</html>
  `.trim();

  return {
    subject,
    body: plainTextBody,
    html: htmlBody
  };
}

/**
 * Send email helper with attachments and HTML support
 */
async function sendEmail(
  to: string, 
  subject: string, 
  body: string, 
  attachments?: any[], 
  html?: string,
  companyId?: string | null
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { transporter, fromName, fromEmail, replyTo, ccEmail, source } = await getCompanyTransporter(companyId);

  if (!transporter) {
    return { 
      success: false, 
      error: 'SMTP configuration is missing. Please configure SMTP in Settings (Settings > SMTP & Mail Configuration) or set SMTP_HOST in .env.' 
    };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      replyTo: replyTo || undefined,
      cc: ccEmail || undefined,
      subject,
      text: body,
      html: html || undefined,
      attachments
    });

    console.log(`✅ Email sent successfully to ${to} (Source: ${source}), MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error(`❌ Nodemailer send error to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}

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
      enabled: reminder.enabled,
      message: `Email reminders ${enabled ? 'enabled' : 'disabled'} for invoice #${invoice?.invoice_no || targetInvoiceId}`,
    });
  } catch (error) {
    console.error('Error updating reminder status:', error);
    res.status(500).json({ error: 'Failed to update reminder status' });
  }
};

// POST /api/invoices/:id/send-reminder - Manually send an invoice reminder on demand
export const sendInvoiceReminder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, recipientEmail, customNote } = req.body;

    const parsedId = parseInt(id as string);
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Valid invoice ID is required' });
    }

    // Find invoice with customer & company relations
    const invoice = await prisma.legacyInvoice.findFirst({
      where: {
        OR: [
          { id: parsedId },
          { invoice_no: parsedId }
        ],
        ...(company_id ? { company_id } : {})
      },
      include: {
        customer: true,
        reminders: true
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: `Invoice #${id} not found` });
    }

    // Determine recipient email
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
 * Core function to process automated invoice payment reminders
 */
export const runScheduledInvoiceReminders = async (companyId?: string) => {
  let sentCount = 0;
  const results: any[] = [];
  const processedInvoiceNos = new Set<string>();

  try {
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
      take: 200 // Batch size for safety
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

      // 4. Resolve effective due date (fall back to invoice_date + 30 days if neither due_date nor inward exists)
      let effectiveDueDate = invoice.due_date;
      if (!effectiveDueDate && invoice.inward_id) {
        effectiveDueDate = inwardDueDateMap.get(invoice.inward_id) || null;
      }
      if (!effectiveDueDate && invoice.invoice_date) {
        const d = new Date(invoice.invoice_date);
        d.setDate(d.getDate() + 30);
        effectiveDueDate = d;
      }

      if (!effectiveDueDate) continue;

      // 5. Calculate reminder schedule milestones
      const reminderDates = calculateReminderDates(effectiveDueDate);
      if (!reminderDates) continue;

      for (const [reminderType, targetDate] of Object.entries(reminderDates)) {
        if (!targetDate) continue;

        if (isToday(targetDate)) {
          // Check if milestone was already sent
          const milestoneAlreadySent = await prisma.emailLog.findFirst({
            where: {
              invoiceId: invoice.id,
              reminderType: reminderType
            }
          });
          if (milestoneAlreadySent) continue;

          // Check if ANY reminder was sent for this invoice today to avoid spamming
          const anySentToday = await prisma.emailLog.findFirst({
            where: {
              invoiceId: invoice.id,
              createdAt: {
                gte: new Date(new Date().setHours(0, 0, 0, 0))
              }
            }
          });
          if (anySentToday) continue;

          // Customer email validation
          const rawCustomerEmail = 
            invoice.customer?.email_id1 || 
            invoice.customer?.email_id2 || 
            invoice.customer?.email_id3 || 
            invoice.customer?.email || 
            null;

          const customerEmail = rawCustomerEmail && emailRegex.test(rawCustomerEmail.trim())
            ? rawCustomerEmail.trim()
            : null;

          if (!customerEmail) {
            continue; // No email on file
          }

          console.log(`📧 Sending automated ${reminderType} reminder for invoice #${invoice.invoice_no}`);
          
          const emailContent = generateEmailContent(invoice, reminderType);
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
            invoice.company_id || undefined
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

            results.push({
              invoiceId: invoice.id,
              invoiceNo: invoice.invoice_no,
              type: reminderType,
              status: 'sent',
              recipient: customerEmail
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('Error in runScheduledInvoiceReminders:', err);
  }

  return { sentCount, results };
};

// GET /api/email-reminder-service - Trigger automated reminders
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

// In-memory tracker for dispatched lead visit reminders on the current day
const sentLeadVisitReminders = new Set<string>();

// Helper function to send visit reminder to the assigned Sales Person for a specific lead
export const sendSingleLeadVisitReminder = async (leadId: string, companyId?: string | null): Promise<{ success: boolean; message: string; recipient?: string }> => {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId }
  });

  if (!lead) {
    throw new Error('Lead record not found');
  }

  if (!lead.agent_id) {
    throw new Error('This lead does not have an assigned Sales Person. Please assign a sales agent first.');
  }

  const salesPerson = await prisma.user.findUnique({
    where: { id: lead.agent_id }
  });

  if (!salesPerson || !salesPerson.email) {
    throw new Error(`Assigned Sales Person (${salesPerson?.name || 'Agent'}) does not have a registered email address.`);
  }

  const visitDateStr = lead.next_visit_date 
    ? new Date(lead.next_visit_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Not scheduled';

  const subject = `[Lead Visit Reminder] Scheduled Visit with ${lead.name} (${lead.company || 'Prospect'})`;

  const plainTextBody = `
Dear ${salesPerson.name || 'Sales Representative'},

This is an automated notification regarding your scheduled upcoming visit for the following prospective client:

Scheduled Visit Date: ${visitDateStr}

Prospect Details:
- Contact Person: ${lead.name}
- Company: ${lead.company || 'N/A'}
- Phone: ${lead.phone || 'N/A'}
- Email: ${lead.email || 'N/A'}
- Assigned Territory/Area: ${lead.assigned_area || 'N/A'}
- Product Interest: ${lead.product_interest || 'N/A'}
- Previous Notes: ${lead.notes || 'N/A'}

Action Required:
Please ensure you are well prepared with product catalogues, sample tools, and follow-up discussion points. After completing the visit, please record the visit outcomes and update the next visit date in the CRM.

Best regards,
Globus Engineering CRM
  `.trim();

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #0f766e, #0d9488); color: #ffffff; padding: 24px; }
    .header h2 { margin: 0 0 4px 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { margin: 0; opacity: 0.9; font-size: 13px; }
    .content { padding: 24px; }
    .visit-box { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 16px; margin: 16px 0; text-align: center; }
    .visit-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.8px; color: #0f766e; font-weight: 700; }
    .visit-date { font-size: 22px; font-weight: 800; color: #115e59; margin-top: 4px; }
    .table-details { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
    .table-details td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
    .table-details td.label { color: #64748b; font-weight: 500; width: 35%; }
    .table-details td.value { color: #0f172a; font-weight: 600; }
    .notes-box { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 14px; border-radius: 4px; font-size: 13px; color: #92400e; margin: 16px 0; }
    .footer { background: #f8fafc; padding: 16px 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2>Globus Engineering Tools</h2>
      <p>Upcoming Lead Visit Reminder &bull; Assigned to ${salesPerson.name}</p>
    </div>
    <div class="content">
      <p style="font-size: 14px; margin-top: 0;">Dear <strong>${salesPerson.name}</strong>,</p>
      <p style="font-size: 14px; color: #475569; line-height: 1.5;">
        This is an automated notification regarding your scheduled upcoming visit for the prospective client below:
      </p>

      <div class="visit-box">
        <div class="visit-label">Scheduled Visit Date</div>
        <div class="visit-date">${visitDateStr}</div>
      </div>

      <table class="table-details">
        <tr>
          <td class="label">Prospect Name</td>
          <td class="value">${lead.name}</td>
        </tr>
        <tr>
          <td class="label">Company</td>
          <td class="value">${lead.company || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Contact Phone</td>
          <td class="value">${lead.phone || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Email Address</td>
          <td class="value">${lead.email || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Assigned Territory</td>
          <td class="value">${lead.assigned_area || 'N/A'}</td>
        </tr>
        <tr>
          <td class="label">Product Interest</td>
          <td class="value">${lead.product_interest || 'N/A'}</td>
        </tr>
      </table>

      ${lead.notes ? `
        <div class="notes-box">
          <strong>Previous Discussion / Notes:</strong><br>
          ${lead.notes}
        </div>
      ` : ''}

      <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-bottom: 0;">
        <strong>Action:</strong> Please ensure you are prepared with product catalogues, sample tools, and follow-up discussion points. After completing the visit, please record the updated visit outcomes in the CRM.
      </p>
    </div>
    <div class="footer">
      Globus Engineering CRM &bull; Automated Sales Field Assistance
    </div>
  </div>
</body>
</html>
  `.trim();

  const sendRes = await sendEmail(
    salesPerson.email,
    subject,
    plainTextBody,
    undefined,
    htmlBody,
    lead.company_id || companyId || undefined
  );

  if (!sendRes.success) {
    throw new Error(sendRes.error || 'Failed to dispatch email via SMTP');
  }

  // Record into in-memory dispatched cache to avoid duplicate sends on the same day
  const reminderKey = `lead_visit_${lead.id}_${visitDateStr}`;
  sentLeadVisitReminders.add(reminderKey);

  return {
    success: true,
    message: `Visit reminder sent successfully to ${salesPerson.name} (${salesPerson.email})`,
    recipient: salesPerson.email
  };
};

// HTTP Endpoint: POST /api/leads/:id/send-visit-reminder
export const sendLeadVisitReminderHttp = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;

    const result = await sendSingleLeadVisitReminder(id as string, company_id as string);
    res.json(result);
  } catch (err: any) {
    console.error('Error sending lead visit reminder:', err);
    res.status(400).json({ error: err.message || 'Failed to send lead visit reminder' });
  }
};

// Process lead visit reminders automatically based on configured leadReminderDays
export const processLeadVisitReminders = async (companyId?: string) => {
  try {
    const companiesToProcess: { id: string; leadReminderDays: number; enableLeadReminders: boolean }[] = [];

    if (companyId) {
      const company = await prisma.company.findUnique({ where: { id: companyId } });
      let leadReminderDays = 1;
      let enableLeadReminders = true;
      if (company?.invoice_settings) {
        try {
          const parsed = JSON.parse(company.invoice_settings);
          if (parsed?.smtp) {
            if (parsed.smtp.leadReminderDays !== undefined) {
              leadReminderDays = Math.max(1, parseInt(parsed.smtp.leadReminderDays) || 1);
            }
            if (parsed.smtp.enableLeadReminders !== undefined) {
              enableLeadReminders = parsed.smtp.enableLeadReminders === true;
            }
          }
        } catch (e) {}
      }
      companiesToProcess.push({ id: companyId, leadReminderDays, enableLeadReminders });
    } else {
      const companies = await prisma.company.findMany();
      for (const comp of companies) {
        let leadReminderDays = 1;
        let enableLeadReminders = true;
        if (comp.invoice_settings) {
          try {
            const parsed = JSON.parse(comp.invoice_settings);
            if (parsed?.smtp) {
              if (parsed.smtp.leadReminderDays !== undefined) {
                leadReminderDays = Math.max(1, parseInt(parsed.smtp.leadReminderDays) || 1);
              }
              if (parsed.smtp.enableLeadReminders !== undefined) {
                enableLeadReminders = parsed.smtp.enableLeadReminders === true;
              }
            }
          } catch (e) {}
        }
        companiesToProcess.push({ id: comp.id, leadReminderDays, enableLeadReminders });
      }
      // Fallback for leads with unassigned/null company_id
      companiesToProcess.push({ id: '', leadReminderDays: 1, enableLeadReminders: true });
    }

    let totalSentCount = 0;
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);

    for (const config of companiesToProcess) {
      if (!config.enableLeadReminders) continue;

      const reminderDays = config.leadReminderDays || 1;

      // Target visit date in IST = today + reminderDays
      const istTarget = new Date(istNow);
      istTarget.setUTCDate(istTarget.getUTCDate() + reminderDays);

      const targetYear = istTarget.getUTCFullYear();
      const targetMonth = istTarget.getUTCMonth();
      const targetDate = istTarget.getUTCDate();

      // UTC window corresponding to the full target calendar day in IST
      const startUtc = new Date(Date.UTC(targetYear, targetMonth, targetDate, 0, 0, 0) - istOffset);
      const endUtc = new Date(Date.UTC(targetYear, targetMonth, targetDate, 23, 59, 59, 999) - istOffset);

      const whereLead: any = {
        next_visit_date: {
          gte: startUtc,
          lte: endUtc
        }
      };

      if (config.id) {
        whereLead.company_id = config.id;
      }

      const leads = await prisma.lead.findMany({
        where: whereLead
      });

      for (const lead of leads) {
        if (!lead.agent_id) continue;

        const visitDateStr = lead.next_visit_date ? new Date(lead.next_visit_date).toLocaleDateString('en-GB') : 'Scheduled';
        const reminderUniqueKey = `lead_visit_${lead.id}_${visitDateStr}_${reminderDays}d`;

        if (sentLeadVisitReminders.has(reminderUniqueKey)) {
          continue;
        }

        try {
          const result = await sendSingleLeadVisitReminder(lead.id, lead.company_id || config.id);
          if (result.success) {
            totalSentCount++;
            sentLeadVisitReminders.add(reminderUniqueKey);
            console.log(`✅ Automated ${reminderDays}-Day Lead Visit Reminder sent to Sales Person ${result.recipient} for lead ${lead.name}`);
          }
        } catch (err: any) {
          console.error(`❌ Failed to send lead visit reminder for ${lead.name}:`, err.message);
        }
      }
    }

    return totalSentCount;
  } catch (error) {
    console.error('Error processing lead visit reminders:', error);
    return 0;
  }
};

function calculateReminderDates(dueDate: Date | string): {
  '30_days': Date;
  '1_week': Date;
  '1_day': Date;
  'today': Date;
  urgent: Date | null;
  overdue_7_days: Date;
  overdue_15_days: Date;
} | null {
  if (!dueDate) return null;
  
  const due = new Date(dueDate);
  if (isNaN(due.getTime())) return null;

  const today = new Date();
  const daysUntilDue = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  return {
    '30_days': new Date(due.getTime() - (30 * 24 * 60 * 60 * 1000)),
    '1_week': new Date(due.getTime() - (7 * 24 * 60 * 60 * 1000)),
    '1_day': new Date(due.getTime() - (1 * 24 * 60 * 60 * 1000)),
    'today': due,
    'urgent': (daysUntilDue <= 3 && daysUntilDue >= 0) ? today : null,
    'overdue_7_days': new Date(due.getTime() + (7 * 24 * 60 * 60 * 1000)),
    'overdue_15_days': new Date(due.getTime() + (15 * 24 * 60 * 60 * 1000)),
  };
}

function isToday(date: Date) {
  const today = new Date();
  return date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
}

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

// GET /api/settings/mail - Get company or system SMTP mail configuration
export const getMailSettings = async (req: Request, res: Response) => {
  try {
    const { company_id } = req.query;

    let smtpConfig: any = null;

    if (company_id && typeof company_id === 'string') {
      const company = await prisma.company.findUnique({
        where: { id: company_id }
      });

      if (company && company.invoice_settings) {
        try {
          const parsed = JSON.parse(company.invoice_settings);
          if (parsed && parsed.smtp) {
            smtpConfig = parsed.smtp;
          }
        } catch (e) {
          console.error('Error parsing company invoice_settings for SMTP:', e);
        }
      }
    }

    const host = smtpConfig?.host || process.env.SMTP_HOST || 'smtp.gmail.com';
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
      leadReminderDays
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
      updatedAt: new Date().toISOString()
    };

    existingSettings.smtp = updatedSmtp;

    await prisma.company.update({
      where: { id: company_id },
      data: {
        invoice_settings: JSON.stringify(existingSettings)
      }
    });

    // Invalidate cached transporter so new settings take effect immediately
    cachedTransporter = null;

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
        leadReminderDays: updatedSmtp.leadReminderDays
      }
    });
  } catch (error: any) {
    console.error('Error updating mail settings:', error);
    res.status(500).json({ error: error.message || 'Failed to update mail settings' });
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

    if (!testEmail || !testEmail.includes('@')) {
      return res.status(400).json({ error: 'Valid test recipient email address is required' });
    }

    // Resolve credentials from request or fallback to company / env
    let host = smtpHost?.trim();
    let port = parseInt(smtpPort);
    let user = smtpUser?.trim();
    let pass = smtpPass;
    let isSecure = secure;
    let senderName = fromName?.trim();
    let senderEmail = fromEmail?.trim();

    if ((!host || !user || !pass || pass === '••••••••') && company_id) {
      const company = await prisma.company.findUnique({ where: { id: company_id } });
      if (company?.invoice_settings) {
        try {
          const parsed = JSON.parse(company.invoice_settings);
          if (parsed?.smtp) {
            host = host || parsed.smtp.host;
            port = port || parsed.smtp.port;
            user = user || parsed.smtp.user;
            if (!pass || pass === '••••••••') pass = parsed.smtp.pass;
            if (isSecure === undefined) isSecure = parsed.smtp.secure;
            senderName = senderName || parsed.smtp.fromName;
            senderEmail = senderEmail || parsed.smtp.fromEmail;
          }
        } catch {}
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

    // 1. Verify connection
    await testTransporter.verify();

    // 2. Send test email
    const testHtml = `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; padding: 24px; color: #1e293b;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="display: inline-block; background: #dcfce7; color: #166534; padding: 10px 20px; border-radius: 50px; font-weight: bold; font-size: 14px;">
        ✓ SMTP Server Verified
      </div>
    </div>
    <h2 style="margin: 0 0 12px 0; color: #0f172a; text-align: center;">SMTP Configuration Test Successful</h2>
    <p style="color: #64748b; line-height: 1.6; text-align: center; margin-bottom: 24px;">
      This test message confirms that your SMTP mail server settings are configured properly in <strong>Globus Engineering CRM</strong>.
    </p>
    <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.8;">
      <div><strong>SMTP Host:</strong> ${host}</div>
      <div><strong>Port:</strong> ${port} (${isSecure || port === 465 ? 'SSL/TLS' : 'STARTTLS'})</div>
      <div><strong>Username:</strong> ${user}</div>
      <div><strong>Sender Display:</strong> ${senderName} &lt;${senderEmail}&gt;</div>
    </div>
    <div style="margin-top: 24px; font-size: 11px; color: #94a3b8; text-align: center;">
      Timestamp: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} &bull; Sent from Globus Engineering CRM
    </div>
  </div>
</body>
</html>
    `;

    const info = await testTransporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to: testEmail,
      subject: `✅ SMTP Configuration Test - Globus Engineering CRM`,
      text: `SMTP Configuration Test Successful!\n\nHost: ${host}:${port}\nUser: ${user}\nFrom: ${senderName} <${senderEmail}>\nTime: ${new Date().toISOString()}`,
      html: testHtml
    });

    res.json({
      success: true,
      message: `Test email successfully delivered to ${testEmail}!`,
      messageId: info.messageId,
      host,
      port
    });
  } catch (error: any) {
    console.error('SMTP test connection failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'SMTP connection failed. Check host, port, credentials, or firewall.' 
    });
  }
};

