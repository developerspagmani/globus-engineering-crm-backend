import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

async function sendVisitNotification(leadEmail: string, leadName: string, companyName: string, visitDate: Date) {
  if (!process.env.SMTP_HOST) {
    console.error('SMTP_HOST not defined');
    return;
  }
  
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const subject = `Upcoming Visit Scheduled - Globus Engineering`;
  const body = `Dear ${leadName},

This is to kindly inform you that a representative from Globus Engineering is scheduled to visit your company, ${companyName || 'your office'}, on ${visitDate.toLocaleDateString()}.

We look forward to meeting with you to discuss how we can support your engineering needs. If you need to reschedule, please let us know.

Best regards,
Globus Engineering Team`;

  try {
    await transporter.sendMail({
      from: `"${process.env.FROM_NAME || 'Globus Engineering'}" <${process.env.FROM_EMAIL || 'noreply@globusengineering.com'}>`,
      to: 'rdhanushkumarramalingam@gmail.com',
      subject,
      text: body
    });
    console.log(`✅ Visit notification sent to rdhanushkumarramalingam@gmail.com (Original: ${leadEmail})`);
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
      latestLead.email || 'no-email@example.com',
      latestLead.name,
      latestLead.company || '',
      visitDate
    );

  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
