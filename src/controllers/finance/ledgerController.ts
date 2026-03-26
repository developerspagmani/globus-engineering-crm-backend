import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getLedgerEntries = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const partyId = req.query.partyId as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  try {
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        AND: [
          companyId ? {
            OR: [
              { company_id: String(companyId) },
              { company_id: String(companyId).toLowerCase() }
            ]
          } : {},
          partyId ? { party_id: String(partyId) } : {}
        ]
      },
      orderBy: { created_at: 'desc' }
    });
    res.json(entries);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch ledger entries', detail: error.message });
  }
};

export const createLedgerEntry = async (req: AuthRequest, res: Response) => {
  const { partyId, partyName, partyType, date, type, amount, description, referenceId, companyId } = req.body;
  const user = req.user;
  const finalCompanyId = user?.role === 'super_admin' ? companyId : user?.company_id;

  try {
    const entry = await prisma.ledgerEntry.create({
      data: {
        id: crypto.randomUUID(),
        party_id: String(partyId),
        party_name: partyName,
        party_type: partyType,
        company_id: finalCompanyId,
        date: date ? new Date(date) : new Date(),
        type: type,
        amount: parseFloat(amount || '0'),
        balance: 0, // Should be calculated or handled by trigger/logic
        description: description,
        reference_id: referenceId,
      } as any
    });
    res.status(201).json(entry);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to add ledger entry', detail: error.message });
  }
};
