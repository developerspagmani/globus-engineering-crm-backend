import { Router } from 'express';
import * as itemController from '../controllers/master/itemController';
import * as processController from '../controllers/master/processController';
import * as priceFixingController from '../controllers/master/priceFixingController';

const router = Router();

/**
 * @openapi
 * /api/items:
 *   get: { summary: Get items, tags: [Master Data], parameters: [{ in: query, name: companyId, schema: { type: string } }], responses: { 200: { description: List of items } } }
 *   post: { summary: Create item, tags: [Master Data], responses: { 201: { description: Created } } }
 * /api/processes:
 *   get: { summary: Get processes, tags: [Master Data], parameters: [{ in: query, name: companyId, schema: { type: string } }], responses: { 200: { description: List of processes } } }
 *   post: { summary: Create process, tags: [Master Data], responses: { 201: { description: Created } } }
 * /api/price-fixings:
 *   get: { summary: Get price fixings, tags: [Master Data], parameters: [{ in: query, name: companyId, schema: { type: string } }], responses: { 200: { description: List of entries } } }
 *   post: { summary: Create price fixing, tags: [Master Data], responses: { 201: { description: Created } } }
 */
// Items
router.get('/items', itemController.getItems);
router.post('/items', itemController.createItem);
router.put('/items/:id', itemController.updateItem);
router.delete('/items/:id', itemController.deleteItem);

// Processes
router.get('/processes', processController.getProcesses);
router.post('/processes', processController.createProcess);
router.put('/processes/:id', processController.updateProcess);
router.delete('/processes/:id', processController.deleteProcess);

// Price Fixing
router.get('/price-fixings', priceFixingController.getPriceFixings);
router.post('/price-fixings', priceFixingController.createPriceFixing);
router.put('/price-fixings/:id', priceFixingController.updatePriceFixing);
router.delete('/price-fixings/:id', priceFixingController.deletePriceFixing);

export default router;
