import { Router } from 'express';
import * as employeeController from '../controllers/employee/employeeController';
import { checkPermission } from '../middleware/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/employees:
 *   get:
 *     summary: Get all employees
 *     tags: [Workforce]
 *     parameters:
 *       - in: query
 *         name: companyId
 *         schema: { type: string }
 *     responses: { 200: { description: List of employees } }
 *   post:
 *     summary: Register an employee
 *     tags: [Workforce]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               employeeId: { type: string }
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               department: { type: string }
 *               designation: { type: string }
 *               salary: { type: number }
 *               joiningDate: { type: string }
 *               status: { type: string }
 *               company_id: { type: string }
 *     responses: { 201: { description: Created } }
 * /api/employees/{id}:
 *   put:
 *     summary: Update employee
 *     tags: [Workforce]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     summary: Delete employee
 *     tags: [Workforce]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses: { 200: { description: Deleted } }
 */
router.get('/employees', checkPermission('mod_employee', 'canRead') as any, employeeController.getAllEmployees);
router.post('/employees', checkPermission('mod_employee', 'canCreate') as any, employeeController.createEmployee);
router.put('/employees/:id', checkPermission('mod_employee', 'canEdit') as any, employeeController.updateEmployee);
router.delete('/employees/:id', checkPermission('mod_employee', 'canDelete') as any, employeeController.deleteEmployee);

export default router;
