import prisma from '../config/prisma';
import crypto from 'crypto';

export async function logAudit({
  action,
  entity,
  entity_id,
  details,
  user_id,
  user_name,
  company_id,
}: {
  action: string;
  entity: string;
  entity_id: string;
  details?: any;
  user_id: string;
  user_name: string;
  company_id?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        action,
        entity,
        entity_id,
        details: details ? JSON.stringify(details) : null,
        user_id,
        user_name,
        company_id: company_id || null,
      },
    });
  } catch (error) {
    console.error('FAILED TO LOG AUDIT:', error);
  }
}
