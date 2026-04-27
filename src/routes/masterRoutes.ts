import { Router } from 'express';
import * as itemController from '../controllers/master/itemController';
import * as processController from '../controllers/master/processController';
import * as priceFixingController from '../controllers/master/priceFixingController';
import { checkPermission } from '../middleware/authMiddleware';
import { validateRequest } from '../middleware/validationMiddleware';
import { itemSchema, processSchema, priceFixingSchema } from '../utils/validationSchemas';

const router = Router();

/**
 * @openapi
 * /api/items:
 *   get:
 *     summary: Get items
 *     tags: [Master Data]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: companyId, schema: { type: string } }]
 *     responses:
 *       200:
 *         description: List of items
 * /api/items/{id}:
 *   put:
 *     summary: Update item
 *     tags: [Master Data]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     summary: Delete item
 *     tags: [Master Data]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Deleted } }
 * /api/processes:
 *   get:
 *     summary: Get processes
 *     tags: [Master Data]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: companyId, schema: { type: string } }]
 *     responses:
 *       200:
 *         description: List of processes
 * /api/processes/{id}:
 *   put:
 *     summary: Update process
 *     tags: [Master Data]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     summary: Delete process
 *     tags: [Master Data]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Deleted } }
 * /api/price-fixings:
 *   get:
 *     summary: Get price fixings
 *     tags: [Master Data]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: companyId, schema: { type: string } }]
 *     responses:
 *       200:
 *         description: List of entries
 * /api/price-fixings/{id}:
 *   put:
 *     summary: Update price fixing
 *     tags: [Master Data]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     summary: Delete price fixing
 *     tags: [Master Data]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Deleted } }
 */
// Items
router.get('/items', checkPermission('mod_items', 'canRead'), itemController.getItems);
router.post('/items', checkPermission('mod_items', 'canCreate'), validateRequest(itemSchema), itemController.createItem);
router.put('/items/:id', checkPermission('mod_items', 'canEdit'), validateRequest(itemSchema), itemController.updateItem);

router.delete('/items/:id', checkPermission('mod_items', 'canDelete'), itemController.deleteItem);

// Processes
router.get('/processes', checkPermission('mod_items', 'canRead'), processController.getProcesses);
router.post('/processes', checkPermission('mod_items', 'canCreate'), validateRequest(processSchema), processController.createProcess);
router.put('/processes/:id', checkPermission('mod_items', 'canEdit'), validateRequest(processSchema), processController.updateProcess);

router.delete('/processes/:id', checkPermission('mod_processes', 'canDelete'), processController.deleteProcess);

// Price Fixing
router.get('/price-fixings', checkPermission('mod_items', 'canRead'), priceFixingController.getPriceFixings);
router.post('/price-fixings', checkPermission('mod_items', 'canCreate'), validateRequest(priceFixingSchema), priceFixingController.createPriceFixing);
router.put('/price-fixings/:id', checkPermission('mod_items', 'canEdit'), validateRequest(priceFixingSchema), priceFixingController.updatePriceFixing);

router.delete('/price-fixings/:id', checkPermission('mod_price_fixing', 'canDelete'), priceFixingController.deletePriceFixing);

export default router;
