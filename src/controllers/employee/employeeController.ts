import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';

export const getAllEmployees = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = (req.query.companyId || req.query.company_id) as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : (user?.company_id || (user as any)?.companyId);

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
      where.AND.push({ company_id: String(companyId) });
    }

    if (search) {
      where.AND.push({
        OR: [
          { ename: { contains: search.toLowerCase() } },
          { ename: { contains: search.toUpperCase() } },
          { email: { contains: search.toLowerCase() } },
          { email: { contains: search.toUpperCase() } },
          { designation: { contains: search.toLowerCase() } },
          { designation: { contains: search.toUpperCase() } },
          { phone_number: { contains: search.toLowerCase() } },
          { phone_number: { contains: search.toUpperCase() } }
        ]
      });
    }

    const [employees, totalCount] = await Promise.all([
      prisma.legacyEmployee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { ename: 'asc' }
      }),
      prisma.legacyEmployee.count({ where })
    ]);

    res.json({
      items: employees,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch employees', detail: error.message });
  }
};

export const createEmployee = async (req: AuthRequest, res: Response) => {
  const user = req.user;
  const companyId = user?.company_id || req.body.companyId || req.body.company_id;

  try {
    const employee = await prisma.legacyEmployee.create({
      data: {
        ename: req.body.name || req.body.ename,
        designation: req.body.designation,
        email: req.body.email,
        phone_number: req.body.phone || req.body.phone_number,
        salary: parseFloat(String(req.body.salary || '0')),
        joining_date: req.body.joiningDate ? new Date(req.body.joiningDate) : new Date(),
        app_status: req.body.status || 'active',
        company_id: String(companyId),
        street1: req.body.street1,
        city: req.body.city,
        state: req.body.state,
        password: req.body.password || '123456', // Default password
      }
    });
    res.status(201).json(employee);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create employee', detail: error.message });
  }
};

export const updateEmployee = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const employee = await prisma.legacyEmployee.update({
      where: { id: parseInt(String(id)) },
      data: {
        ename: req.body.name || req.body.ename,
        designation: req.body.designation,
        email: req.body.email,
        phone_number: req.body.phone || req.body.phone_number,
        salary: req.body.salary ? parseFloat(String(req.body.salary)) : undefined,
        joining_date: req.body.joiningDate ? new Date(req.body.joiningDate) : undefined,
        app_status: req.body.status || req.body.app_status,
        street1: req.body.street1,
        city: req.body.city,
        state: req.body.state,
      }
    });
    res.json(employee);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update employee', detail: error.message });
  }
};

export const deleteEmployee = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.legacyEmployee.delete({
      where: { id: parseInt(String(id)) }
    });
    res.json({ message: 'Employee deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete employee', detail: error.message });
  }
};

