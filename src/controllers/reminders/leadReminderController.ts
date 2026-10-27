import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import { sendEmail } from './reminderCommon';

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

  // Look up sales representative in User table first (primary CRM user table)
  let salesPerson: { id?: string | number; name?: string | null; email?: string | null; phone?: string | null } | null = await prisma.user.findFirst({
    where: {
      OR: [
        { id: lead.agent_id },
        { name: lead.agent_id },
        { email: lead.agent_id }
      ]
    },
    select: { id: true, name: true, email: true, phone: true }
  });

  // Fallback to LegacyEmployee table if not found in User
  if (!salesPerson) {
    const parsedId = parseInt(lead.agent_id, 10);
    const legacyEmp = await prisma.legacyEmployee.findFirst({
      where: {
        OR: [
          ...(isNaN(parsedId) ? [] : [{ id: parsedId }]),
          { ename: lead.agent_id },
          { email: lead.agent_id }
        ]
      },
      select: { id: true, ename: true, email: true, phone_number: true }
    });

    if (legacyEmp) {
      salesPerson = {
        id: legacyEmp.id,
        name: legacyEmp.ename,
        email: legacyEmp.email,
        phone: legacyEmp.phone_number
      };
    }
  }

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
          <strong>Previous Interaction Notes:</strong><br>
          ${lead.notes}
        </div>
      ` : ''}

      <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-top: 20px;">
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
