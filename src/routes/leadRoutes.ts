import { Router } from 'express';
import * as leadController from '../controllers/leads/leadController';
import * as dealController from '../controllers/leads/dealController';
import { checkPermission } from '../middleware/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/leads:
 *   get: { summary: Get leads, tags: [CRM], parameters: [{ in: query, name: companyId, schema: { type: string } }], responses: { 200: { description: List of leads } } }
 *   post: { summary: Create lead, tags: [CRM], responses: { 201: { description: Created } } }
 * /api/deals:
 *   get: { summary: Get deals, tags: [CRM], parameters: [{ in: query, name: companyId, schema: { type: string } }], responses: { 200: { description: List of deals } } }
 *   post: { summary: Create deal, tags: [CRM], responses: { 201: { description: Created } } }
 */
// Leads
router.get('/leads', checkPermission('mod_lead', 'canRead') as any, leadController.getAllLeads);
router.post('/leads', checkPermission('mod_lead', 'canCreate') as any, leadController.createLead);
router.put('/leads/:id', checkPermission('mod_lead', 'canEdit') as any, leadController.updateLead);
router.delete('/leads/:id', checkPermission('mod_lead', 'canDelete') as any, leadController.deleteLead);

// Deals (Split into dealController)
router.get('/deals', checkPermission('mod_sales_hub', 'canRead') as any, dealController.getAllDeals);
router.post('/deals', checkPermission('mod_sales_hub', 'canCreate') as any, dealController.createDeal);
router.put('/deals/:id', checkPermission('mod_sales_hub', 'canEdit') as any, dealController.updateDeal);
router.delete('/deals/:id', checkPermission('mod_sales_hub', 'canDelete') as any, dealController.deleteDeal);

export default router;
