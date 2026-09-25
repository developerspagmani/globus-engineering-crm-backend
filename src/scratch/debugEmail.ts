import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

async function sendTestEmailDebug() {
  let config: any = null;

  // 1. Try to read SMTP from Company settings in database
  const configuredCompany = await prisma.company.findFirst({
    where: { invoice_settings: { contains: '"smtp"' } }
  });

  if (configuredCompany?.invoice_settings) {
    try {
      const parsed = JSON.parse(configuredCompany.invoice_settings);
      if (parsed?.smtp && parsed.smtp.host && parsed.smtp.user && parsed.smtp.pass) {
        config = {
          host: parsed.smtp.host,
          port: parseInt(parsed.smtp.port) || 587,
          secure: parsed.smtp.secure === true || parseInt(parsed.smtp.port) === 465,
          user: parsed.smtp.user,
          pass: parsed.smtp.pass,
          fromName: parsed.smtp.fromName || 'Globus Engineering',
          fromEmail: parsed.smtp.fromEmail || parsed.smtp.user,
          source: `Settings (Company: ${configuredCompany.name || configuredCompany.id})`
        };
      }
    } catch (e) {}
  }

  // 2. If not configured in Settings, fall back to .env
  if (!config) {
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      config = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_PORT === '465',
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        fromName: process.env.FROM_NAME || 'Globus Engineering',
        fromEmail: process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@globusengineering.com',
        source: '.env file'
      };
    }
  }

  if (!config) {
    console.error('❌ SMTP configuration is missing: Neither Settings nor .env has SMTP credentials.');
    return;
  }

  console.log('Testing SMTP Configuration:');
  console.log('Config Source:', config.source);
  console.log('Host:', config.host);
  console.log('Port:', config.port);
  console.log('User:', config.user);
  console.log('From:', `"${config.fromName}" <${config.fromEmail}>`);

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    logger: true,
    debug: true
  });

  try {
    console.log('Verifying connection...');
    await transporter.verify();
    console.log('Connection verified successfully.');

    const subject = `SMTP Debug Test - Globus Engineering (${config.source})`;
    const body = `This is a test email to verify SMTP configuration.\nConfiguration Source: ${config.source}\nSent at: ${new Date().toISOString()}`;

    console.log('Sending email...');
    const info = await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: 'rdhanushkumarramalingam@gmail.com',
      subject,
      text: body
    });

    console.log(`✅ Email sent successfully!`);
    console.log(`Message ID: ${info.messageId}`);
    console.log(`Response: ${info.response}`);
  } catch (err) {
    console.error('❌ Failed to send email:', err);
  }
}

sendTestEmailDebug().finally(() => prisma.$disconnect());
