import { Router } from 'express';
import * as inwardController from '../controllers/logistics/inwardController';
import * as outwardController from '../controllers/logistics/outwardController';
import { checkPermission } from '../middleware/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/inward:
 *   get: { summary: Get inward entries, tags: [Logistics], parameters: [{ in: query, name: companyId, schema: { type: string } }], responses: { 200: { description: List of entries } } }
 *   post: { summary: Create inward entry, tags: [Logistics], responses: { 201: { description: Created } } }
 * /api/inward/pending/{customerId}:
 *   get: { summary: Get pending inwards for customer, tags: [Logistics], parameters: [{ in: path, name: customerId, required: true, schema: { type: string } }], responses: { 200: { description: List of pending inwards } } }
 * /api/outward:
 *   get: { summary: Get outward entries, tags: [Logistics], parameters: [{ in: query, name: companyId, schema: { type: string } }], responses: { 200: { description: List of entries } } }
 *   post: { summary: Create outward entry, tags: [Logistics], responses: { 201: { description: Created } } }
 * /api/outward/pending/{vendorId}:
 *   get: { summary: Get pending outwards for vendor (Job Work), tags: [Logistics], parameters: [{ in: path, name: vendorId, required: true, schema: { type: string } }], responses: { 200: { description: List of pending outwards } } }
 */
// Inward Entry
router.get('/inward/sequence-dc', checkPermission('mod_inward', 'canCreate') as any, inwardController.generateDcNo);
router.get('/inward', checkPermission('mod_inward', 'canRead') as any, inwardController.getInwardEntries);
router.get('/inward/pending/:customerId', checkPermission('mod_inward', 'canRead') as any, inwardController.getPendingInwardsByCustomer);
router.get('/inward/:id', checkPermission('mod_inward', 'canRead') as any, inwardController.getInwardById);
router.post('/inward', checkPermission('mod_inward', 'canCreate') as any, inwardController.createInwardEntry);
router.put('/inward/:id', checkPermission('mod_inward', 'canEdit') as any, inwardController.updateInwardEntry);
router.put('/inward/:id/cancel', checkPermission('mod_inward', 'canEdit') as any, inwardController.cancelInwardEntry);
router.delete('/inward/:id', checkPermission('mod_inward', 'canDelete') as any, inwardController.deleteInwardEntry);

// Outward Entry
router.get('/outward', checkPermission('mod_outward', 'canRead') as any, outwardController.getOutwardEntries);
router.get('/outward/pending/:vendorId', checkPermission('mod_outward', 'canRead') as any, outwardController.getPendingOutwardsByVendor);
router.get('/outward/:id', checkPermission('mod_outward', 'canRead') as any, outwardController.getOutwardById);
router.post('/outward', checkPermission('mod_outward', 'canCreate') as any, outwardController.createOutwardEntry);
router.put('/outward/:id', checkPermission('mod_outward', 'canEdit') as any, outwardController.updateOutwardEntry);
router.delete('/outward/:id', checkPermission('mod_outward', 'canDelete') as any, outwardController.deleteOutwardEntry);

export default router;
