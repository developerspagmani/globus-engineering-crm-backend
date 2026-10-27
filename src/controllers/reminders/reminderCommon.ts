import prisma from '../../config/prisma';
import nodemailer from 'nodemailer';
import { generateInvoicePDF } from '../../utils/pdfGenerator';
import { getCompanyTransporter } from '../../utils/email';

export const cleanStr = (val: any): string => {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (str.toLowerCase() === 'null') return '';
  return str;
};

// Cached nodemailer transporter
export let cachedTransporter: nodemailer.Transporter | null = null;

export async function getTransporter(companyId?: string | null): Promise<nodemailer.Transporter | null> {
  const { transporter } = await getCompanyTransporter(companyId);
  return transporter;
}

/**
 * Format currency in Indian Rupees
 */
export const formatINR = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
};

/**
 * Prepare dynamic invoice PDF Buffer
 */
export async function prepareInvoicePDF(invoice: any): Promise<Buffer> {
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

  // Parse invoice settings to check if declaration text is configured
  let showDeclaration = true;
  let declarationText = 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.';
  if (companyObj?.invoice_settings) {
    try {
      const parsedSettings = JSON.parse(companyObj.invoice_settings);
      if (parsedSettings.declaration !== undefined) {
        showDeclaration = parsedSettings.declaration;
      }
      if (parsedSettings.declaration_text) {
        declarationText = parsedSettings.declaration_text;
      }
    } catch (e) {
      // Use defaults if JSON parsing fails
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
export function generateEmailContent(invoice: any, reminderType: string = 'standard', customNote?: string, companyObj?: any) {
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

  const companyName = companyObj?.company_name || companyObj?.name || 'Globus Engineering Tools';
  const companyAddress = companyObj?.company_address || 'No 24, Annaiyappan Street, S.S. Nagar, Nallampalayam, Ganapathy Post, Coimbatore - 641006.';
  const companyGst = companyObj?.gst_no || '33AAIFG6568K1ZZ';
  const companyEmail = companyObj?.email || 'accounts@globusengineering.com';

  let subjectTypePrefix = 'Payment Reminder';
  if (reminderType === 'today') {
    subjectTypePrefix = 'Action Required: Payment Due Today';
  } else if (reminderType === '1_day') {
    subjectTypePrefix = 'Upcoming Payment: Due Tomorrow';
  } else if (reminderType === '3_days' || reminderType === '1_week') {
    subjectTypePrefix = 'Upcoming Payment Reminder';
  } else if (reminderType === '60_days' || reminderType === '30_days' || reminderType === '15_days' || reminderType.startsWith('custom_before_')) {
    subjectTypePrefix = 'Advance Payment Notice';
  } else if (reminderType === 'urgent' || reminderType.includes('overdue') || reminderType.startsWith('custom_after_')) {
    const overdueLabel = reminderType === 'overdue_3_days' ? ' (3 Days Overdue)'
      : reminderType === 'overdue_7_days' ? ' (7 Days Overdue)'
      : reminderType === 'overdue_15_days' ? ' (15 Days Overdue)'
      : reminderType === 'overdue_30_days' ? ' (30 Days Overdue)'
      : '';
    subjectTypePrefix = `URGENT: Payment Overdue Notice${overdueLabel}`;
  } else if (reminderType === 'manual') {
    subjectTypePrefix = `Invoice #${invoiceNumber} & Payment Reminder`;
  }

  const subject = `${subjectTypePrefix} - Invoice #${invoiceNumber} - ${companyName}`;

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
${companyName}
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
      <h2>${companyName}</h2>
      <p>${subjectTypePrefix} &bull; Invoice #${invoiceNumber}</p>
    </div>
    <div class="content">
      <div class="greeting">Dear ${displayCustomerName},</div>
      <p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">
        This is a friendly reminder regarding your outstanding invoice with ${companyName}. Please find the summary below:
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
      <strong>${companyName}</strong><br>
      ${companyAddress}<br>
      GST: ${companyGst} &bull; Contact: ${companyEmail}
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
export async function sendEmail(
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

export function calculateReminderDates(dueDate: Date | string, customBefore?: string, customAfter?: string): Record<string, Date | null> | null {
  if (!dueDate) return null;
  
  const due = new Date(dueDate);
  if (isNaN(due.getTime())) return null;

  const dates: Record<string, Date | null> = {
    '60_days': new Date(due.getTime() - (60 * 24 * 60 * 60 * 1000)),
    '30_days': new Date(due.getTime() - (30 * 24 * 60 * 60 * 1000)),
    '15_days': new Date(due.getTime() - (15 * 24 * 60 * 60 * 1000)),
    '1_week': new Date(due.getTime() - (7 * 24 * 60 * 60 * 1000)),
    '3_days': new Date(due.getTime() - (3 * 24 * 60 * 60 * 1000)),
    '1_day': new Date(due.getTime() - (1 * 24 * 60 * 60 * 1000)),
    'today': due,
    'overdue_3_days': new Date(due.getTime() + (3 * 24 * 60 * 60 * 1000)),
    'overdue_7_days': new Date(due.getTime() + (7 * 24 * 60 * 60 * 1000)),
    'overdue_15_days': new Date(due.getTime() + (15 * 24 * 60 * 60 * 1000)),
    'overdue_30_days': new Date(due.getTime() + (30 * 24 * 60 * 60 * 1000)),
  };

  if (customBefore) {
    const beforeList = customBefore.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
    for (const d of beforeList) {
      dates[`custom_before_${d}`] = new Date(due.getTime() - (d * 24 * 60 * 60 * 1000));
    }
  }

  if (customAfter) {
    const afterList = customAfter.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);
    for (const d of afterList) {
      dates[`custom_after_${d}`] = new Date(due.getTime() + (d * 24 * 60 * 60 * 1000));
    }
  }

  return dates;
}

export function isToday(date: Date): boolean {
  const today = new Date();
  return date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
}
