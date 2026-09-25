import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

async function getSmtpConfig(companyId?: string | null) {
  let settingsSmtp: any = null;

  if (companyId) {
    const comp = await prisma.company.findUnique({ where: { id: companyId } });
    if (comp?.invoice_settings) {
      try {
        const parsed = JSON.parse(comp.invoice_settings);
        if (parsed?.smtp && parsed.smtp.host && parsed.smtp.user && parsed.smtp.pass) {
          settingsSmtp = parsed.smtp;
        }
      } catch (e) {}
    }
  }

  if (!settingsSmtp) {
    const anyComp = await prisma.company.findFirst({
      where: { invoice_settings: { contains: '"smtp"' } }
    });
    if (anyComp?.invoice_settings) {
      try {
        const parsed = JSON.parse(anyComp.invoice_settings);
        if (parsed?.smtp && parsed.smtp.host && parsed.smtp.user && parsed.smtp.pass) {
          settingsSmtp = parsed.smtp;
        }
      } catch (e) {}
    }
  }

  if (settingsSmtp) {
    const port = parseInt(settingsSmtp.port) || 587;
    return {
      host: settingsSmtp.host,
      port,
      secure: settingsSmtp.secure === true || port === 465,
      user: settingsSmtp.user,
      pass: settingsSmtp.pass,
      fromName: settingsSmtp.fromName || 'Globus Engineering',
      fromEmail: settingsSmtp.fromEmail || settingsSmtp.user,
      source: 'Settings'
    };
  }

  // Fallback to .env
  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    fromName: process.env.FROM_NAME || 'Globus Engineering',
    fromEmail: process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@globusengineering.com',
    source: '.env'
  };
}

async function sendVisitNotification(leadEmail: string, leadName: string, companyName: string, visitDate: Date, companyId?: string | null) {
  const config = await getSmtpConfig(companyId);

  if (!config.host || !config.user || !config.pass) {
    console.error('❌ SMTP credentials not found in Settings or .env');
    return;
  }
  
  console.log(`Using SMTP configuration from ${config.source} (${config.host}:${config.port})`);

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  const subject = `Upcoming Visit Scheduled - ${config.fromName}`;
  const body = `Dear ${leadName},

This is to kindly inform you that a representative from ${config.fromName} is scheduled to visit your company, ${companyName || 'your office'}, on ${visitDate.toLocaleDateString()}.

We look forward to meeting with you to discuss how we can support your engineering needs. If you need to reschedule, please let us know.

Best regards,
${config.fromName} Team`;

  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: leadEmail,
      subject,
      text: body
    });
    console.log(`✅ Visit notification sent to ${leadEmail} (Source: ${config.source})`);
  } catch (err) {
    console.error('❌ Failed to send lead visit email:', err);
  }
}

async function run() {
  try {
    const latestLead = await prisma.lead.findFirst({
      orderBy: { created_at: 'desc' }
    });

    if (!latestLead) {
      console.log('No leads found.');
      return;
    }

    console.log(`Found lead: ${latestLead.name} (${latestLead.company}) - Next Visit: ${latestLead.next_visit_date}`);

    const visitDate = latestLead.next_visit_date || new Date();

    await sendVisitNotification(
      latestLead.email || 'rdhanushkumarramalingam@gmail.com',
      latestLead.name,
      latestLead.company || '',
      visitDate,
      latestLead.company_id
    );

  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
