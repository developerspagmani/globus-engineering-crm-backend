import { Router } from 'express';
import * as companyController from '../controllers/company/companyController';
import { authorize } from '../middleware/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/companies:
 *   get: { summary: Get all companies (Public), tags: [Administration], responses: { 200: { description: List of companies } } }
 *   post: { summary: Create company (Super Admin), tags: [Administration], responses: { 201: { description: Created } } }
 */
router.get('/companies', companyController.getAllCompanies);
router.post('/companies', authorize(['super_admin']) as any, companyController.createCompany);
router.put('/companies/:id', authorize(['super_admin']) as any, companyController.updateCompany);
router.delete('/companies/:id', authorize(['super_admin']) as any, companyController.deleteCompany);

export default router;
