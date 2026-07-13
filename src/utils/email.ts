import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendOtpEmail = async (to: string, otp: string) => {
  try {
    const fromName = process.env.FROM_NAME || 'Globus Engineering CRM';
    const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER;

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
    console.log(`✅ OTP email sent successfully to ${to}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending OTP email:', error);
    return false;
  }
};
