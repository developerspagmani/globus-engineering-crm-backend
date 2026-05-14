import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';
import crypto from 'crypto';

export const getAllChallans = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.company_id || req.query.companyId) as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId || queryCompanyId);

  // Pagination & Filter Params
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const search = (req.query.search as string || '').toLowerCase();

  try {
    const where: any = {
      AND: []
    };

    if (companyId) {
      where.AND.push({
        OR: [
          { company_id: String(companyId) },
          { company_id: String(companyId).toLowerCase() }
        ]
      });
    }

    if (req.query.inward_id) {
      where.AND.push({ inward_id: String(req.query.inward_id) });
    }

    if (search) {
      where.AND.push({
        OR: [
          { challan_no: { contains: search.toLowerCase() } },
          { challan_no: { contains: search.toUpperCase() } },
          { party_name: { contains: search.toLowerCase() } },
          { party_name: { contains: search.toUpperCase() } },
          { vehicle_no: { contains: search.toLowerCase() } },
          { vehicle_no: { contains: search.toUpperCase() } }
        ]
      });
    }

    const [challans, totalCount] = await Promise.all([
      prisma.challan.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' }
      }),
      prisma.challan.count({ where })
    ]);

    res.json({
      items: challans.map((c: any) => ({ ...c, items: JSON.parse(c.items_json || '[]') })),
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch challans', detail: error.message });
  }
};

export const createChallan = async (req: AuthRequest, res: Response) => {
  const { 
    id, challan_no, party_id, party_name, party_type, 
    company_id, type, bill_type, status, items, vehicle_no, 
    driver_name, inward_id, inward_no 
  } = req.body;
  const user = req.user;

  const finalCompanyId = user?.role === 'super_admin' 
    ? (company_id || (req.body as any).companyId) 
    : (user?.company_id || (user as any)?.companyId || company_id || (req.body as any).companyId);
    
    const sanitizedCompanyId = finalCompanyId ? String(finalCompanyId).toLowerCase() : '';

    try {
        const challanData: any = {
            id: id ? String(id) : `CHL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            challan_no: String(challan_no || `DC-${Date.now()}`),
            party_id: party_id ? String(party_id) : null,
            party_name: String(party_name || 'N/A'),
            party_type: String(party_type || 'customer'),
            company_id: sanitizedCompanyId || '',
            date: new Date(),
            type: String(type || 'delivery'),
            bill_type: String(bill_type || 'With Process'),
            status: String(status || 'dispatched'),
            items_json: JSON.stringify(Array.isArray(items) ? items : []),
            vehicle_no: String(vehicle_no || 'N/A'),
            driver_name: String(driver_name || 'N/A'),
            inward_id: inward_id ? String(inward_id) : null,
            inward_no: inward_no ? String(inward_no) : null
        };

        console.log('Final Normalized Challan Data:', JSON.stringify(challanData, null, 2));
        
        let attempts = 0;
        let challan;
        while (attempts < 3) {
            try {
                challan = await prisma.challan.create({
                    data: challanData
                });
                break; // Success!
            } catch (err: any) {
                attempts++;
                console.error(`Attempt ${attempts} error:`, err.message || err);
                if (err.code === 'P1017' && attempts < 3) {
                   await new Promise(resolve => setTimeout(resolve, 500)); 
                   continue;
                }
                throw err; 
            }
        }

        if (!challan) throw new Error("Challan creation returned empty");

        console.log('Challan created successfully:', challan.id);
        return res.status(201).json({ ...challan, items: JSON.parse(challan.items_json || '[]') });
  } catch (error: any) {
    console.error('❌ PRISMA CHALLAN CREATE ERROR:', error.message || error);
    return res.status(500).json({ 
      error: 'Failed to create challan', 
      message: error.message || 'Unknown database error',
      code: error.code
    });
  }
};

export const updateChallan = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { challan_no, party_id, party_name, party_type, type, bill_type, status, items, vehicle_no, driver_name, inward_id, inward_no, company_id, date } = req.body;
  try {
    let attempts = 0;
    let challan;
    while (attempts < 3) {
        try {
            challan = await prisma.challan.update({
                where: { id: String(id) },
                data: {
                    challan_no: challan_no ? String(challan_no) : undefined,
                    party_id: party_id ? String(party_id) : undefined,
                    party_name: party_name ? String(party_name) : undefined,
                    party_type: party_type ? String(party_type) : undefined,
                    company_id: company_id ? String(company_id) : undefined,
                    date: date ? new Date(date) : undefined,
                    type: type ? String(type) : undefined,
                    bill_type: bill_type ? String(bill_type) : undefined,
                    status: status ? String(status) : undefined,
                    items_json: items ? JSON.stringify(Array.isArray(items) ? items : []) : undefined,
                    vehicle_no: vehicle_no ? String(vehicle_no) : undefined,
                    driver_name: driver_name ? String(driver_name) : undefined,
                    inward_id: inward_id ? String(inward_id) : undefined,
                    inward_no: inward_no ? String(inward_no) : undefined
                }
            });
            break;
        } catch (err: any) {
            attempts++;
            if (err.code === 'P1017' && attempts < 3) {
               console.warn(`Update attempt ${attempts} failed with P1017, retrying...`);
               await new Promise(resolve => setTimeout(resolve, 500));
               continue;
            }
            throw err;
        }
    }
    res.json({ ...challan, items: JSON.parse(challan?.items_json || '[]') });
  } catch (error: any) {
    console.error('❌ PRISMA CHALLAN UPDATE ERROR:', error);
    res.status(500).json({ error: 'Failed to update challan', message: error.message, detail: error.code });
  }
};

export const deleteChallan = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.challan.delete({ where: { id: String(id) } });
    res.json({ message: 'Challan deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete challan', detail: error.message });
  }
};

export const getChallanById = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const challan = await prisma.challan.findUnique({
      where: { id: String(id) }
    });

    if (!challan) {
      return res.status(404).json({ error: 'Challan not found' });
    }

    res.json({
      ...challan,
      items: JSON.parse(challan.items_json || '[]')
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch challan details', detail: error.message });
  }
};
