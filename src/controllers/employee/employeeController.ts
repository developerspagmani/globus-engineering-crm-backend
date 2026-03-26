import { Response } from 'express';
import prisma from '../../config/prisma';
import { AuthRequest } from '../../middleware/authMiddleware';

export const getAllEmployees = async (req: AuthRequest, res: Response) => {
  const queryCompanyId = req.query.companyId as string;
  const user = req.user;

  const companyId = user?.role === 'super_admin' ? queryCompanyId : user?.company_id;

  try {
    const employees = await prisma.legacyEmployee.findMany({
      where: companyId ? { company_id: String(companyId) } : {}
    });
    res.json(employees);
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

