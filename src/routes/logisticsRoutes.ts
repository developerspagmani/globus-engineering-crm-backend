import { Router } from 'express';
import * as inwardController from '../controllers/logistics/inwardController';
import * as outwardController from '../controllers/logistics/outwardController';
import { checkPermission } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validationMiddleware';
import { inwardSchema, outwardSchema } from '../utils/validationSchemas';


const router = Router();

/**
 * @openapi
 * /api/inward:
 *   get: { summary: Get inward entries, tags: [Logistics], parameters: [{ in: query, name: companyId, schema: { type: string } }], responses: { 200: { description: List of entries } } }
 *   post: { summary: Create inward entry, tags: [Logistics], responses: { 201: { description: Created } } }
 * /api/outward:
 *   get: { summary: Get outward entries, tags: [Logistics], parameters: [{ in: query, name: companyId, schema: { type: string } }], responses: { 200: { description: List of entries } } }
 *   post: { summary: Create outward entry, tags: [Logistics], responses: { 201: { description: Created } } }
 */
// Inward Entry
router.get('/inward', checkPermission('mod_inward', 'canRead') as any, inwardController.getInwardEntries);
router.get('/inward/pending/:customerId', checkPermission('mod_inward', 'canRead') as any, inwardController.getPendingInwardsByCustomer);
router.post('/inward', checkPermission('mod_inward', 'canCreate') as any, validateRequest(inwardSchema) as any, inwardController.createInwardEntry);
router.put('/inward/:id', checkPermission('mod_inward', 'canEdit') as any, validateRequest(inwardSchema) as any, inwardController.updateInwardEntry);

router.delete('/inward/:id', checkPermission('mod_inward', 'canDelete') as any, inwardController.deleteInwardEntry);

// Outward Entry
router.get('/outward', checkPermission('mod_outward', 'canRead') as any, outwardController.getOutwardEntries);
router.post('/outward', checkPermission('mod_outward', 'canCreate') as any, validateRequest(outwardSchema) as any, outwardController.createOutwardEntry);
router.put('/outward/:id', checkPermission('mod_outward', 'canEdit') as any, validateRequest(outwardSchema) as any, outwardController.updateOutwardEntry);

router.delete('/outward/:id', checkPermission('mod_outward', 'canDelete') as any, outwardController.deleteOutwardEntry);

export default router;
