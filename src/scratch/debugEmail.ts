import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

async function sendTestEmailDebug() {
  if (!process.env.SMTP_HOST) {
    console.error('SMTP_HOST not defined');
    return;
  }
  
  console.log('Testing SMTP Configuration:');
  console.log('Host:', process.env.SMTP_HOST);
  console.log('Port:', process.env.SMTP_PORT);
  console.log('User:', process.env.SMTP_USER);
  
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    logger: true,
    debug: true
  });

  try {
    console.log('Verifying connection...');
    await transporter.verify();
    console.log('Connection verified successfully.');
    
    const subject = `SMTP Debug Test - Globus Engineering`;
    const body = `This is a test email to verify SMTP configuration.\n\nSent at: ${new Date().toISOString()}`;

    console.log('Sending email...');
    const info = await transporter.sendMail({
      from: `"${process.env.FROM_NAME || 'Globus Engineering'}" <${process.env.FROM_EMAIL || 'noreply@globusengineering.com'}>`,
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
