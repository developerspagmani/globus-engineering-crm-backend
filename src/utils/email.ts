import nodemailer from 'nodemailer';
import prisma from '../config/prisma';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  ccEmail?: string;
  source: 'settings' | 'env' | 'none';
}

/**
 * Resolves SMTP configuration:
 * 1. Checks Company settings (Company.invoice_settings.smtp for companyId, or first configured company if omitted)
 * 2. If not configured in settings, falls back to .env variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, etc.)
 */
export async function getCompanySmtpConfig(companyId?: string | null): Promise<SmtpConfig> {
  let settingsSmtp: any = null;

  if (companyId) {
    try {
      const company = await prisma.company.findUnique({ where: { id: companyId } });
      if (company?.invoice_settings) {
        const parsed = JSON.parse(company.invoice_settings);
        if (parsed?.smtp && parsed.smtp.host && parsed.smtp.user && parsed.smtp.pass) {
          settingsSmtp = parsed.smtp;
        }
      }
    } catch (err) {
      console.error('Error reading company SMTP settings:', err);
    }
  }

  // If no companyId was supplied, or specific company has no SMTP configured, check first configured company
  if (!settingsSmtp) {
    try {
      const firstConfigured = await prisma.company.findFirst({
        where: { invoice_settings: { contains: '"smtp"' } }
      });
      if (firstConfigured?.invoice_settings) {
        const parsed = JSON.parse(firstConfigured.invoice_settings);
        if (parsed?.smtp && parsed.smtp.host && parsed.smtp.user && parsed.smtp.pass) {
          settingsSmtp = parsed.smtp;
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  // 1. If configured in Settings, use settings configuration
  if (settingsSmtp && settingsSmtp.host && settingsSmtp.user && settingsSmtp.pass) {
    const port = parseInt(settingsSmtp.port) || 587;
    return {
      host: settingsSmtp.host.trim(),
      port,
      secure: settingsSmtp.secure === true || port === 465,
      user: settingsSmtp.user.trim(),
      pass: settingsSmtp.pass,
      fromName: settingsSmtp.fromName?.trim() || process.env.FROM_NAME || 'Globus Engineering',
      fromEmail: settingsSmtp.fromEmail?.trim() || settingsSmtp.user.trim(),
      replyTo: settingsSmtp.replyTo?.trim() || undefined,
      ccEmail: settingsSmtp.ccEmail?.trim() || undefined,
      source: 'settings'
    };
  }

  // 2. If not configured in settings, fall back to .env
  const envHost = process.env.SMTP_HOST || '';
  const envUser = process.env.SMTP_USER || '';
  const envPass = process.env.SMTP_PASS || '';
  const envPort = parseInt(process.env.SMTP_PORT || '587');

  return {
    host: envHost || 'smtp.gmail.com',
    port: envPort,
    secure: envPort === 465 || process.env.SMTP_PORT === '465',
    user: envUser,
    pass: envPass,
    fromName: process.env.FROM_NAME || 'Globus Engineering CRM',
    fromEmail: process.env.FROM_EMAIL || envUser || 'noreply@globusengineering.com',
    source: (envHost && envUser && envPass) ? 'env' : 'none'
  };
}

/**
 * Returns a nodemailer Transporter and sender identity based on Settings (with .env fallback)
 */
export async function getCompanyTransporter(companyId?: string | null): Promise<{
  transporter: nodemailer.Transporter | null;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  ccEmail?: string;
  source: 'settings' | 'env' | 'none';
}> {
  const config = await getCompanySmtpConfig(companyId);

  if (!config.host || !config.user || !config.pass) {
    console.error('❌ Email configuration missing: neither Settings nor .env has SMTP credentials.');
    return {
      transporter: null,
      fromName: config.fromName,
      fromEmail: config.fromEmail,
      source: 'none'
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  return {
    transporter,
    fromName: config.fromName,
    fromEmail: config.fromEmail,
    replyTo: config.replyTo,
    ccEmail: config.ccEmail,
    source: config.source
  };
}

export const sendOtpEmail = async (to: string, otp: string, companyId?: string | null) => {
  try {
    const { transporter, fromName, fromEmail, source } = await getCompanyTransporter(companyId);

    if (!transporter) {
      console.error('❌ Cannot send OTP email: SMTP is not configured in Settings or .env');
      return false;
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #0d6efd; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 24px;">Password Reset Request</h2>
        </div>
        <div style="padding: 30px; background-color: #ffffff;">
          <p style="font-size: 16px; color: #333333;">Hello,</p>
          <p style="font-size: 16px; color: #333333;">We received a request to reset your password. Use the verification code below to proceed.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <span style="display: inline-block; padding: 15px 30px; background-color: #f8f9fa; border: 2px dashed #0d6efd; border-radius: 6px; font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #0d6efd;">
              ${otp}
            </span>
          </div>
          
          <p style="font-size: 14px; color: #666666;">This code is valid for 10 minutes. If you did not request a password reset, please ignore this email or contact support.</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 15px; text-align: center; border-top: 1px solid #e0e0e0;">
          <p style="margin: 0; font-size: 12px; color: #999999;">&copy; ${new Date().getFullYear()} ${fromName}. All rights reserved.</p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: 'Your Password Reset OTP',
      html: htmlContent,
    });
    console.log(`✅ OTP email sent successfully to ${to} (Source: ${source})`);
    return true;
  } catch (error) {
    console.error('❌ Error sending OTP email:', error);
    return false;
  }
};
