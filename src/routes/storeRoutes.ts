import express from 'express';
import * as storeController from '../controllers/stores/storeController';
import { authenticate, checkPermission } from '../middleware/authMiddleware';

const router = express.Router();

/**
 * @openapi
 * tags:
 *   name: Stores
 *   description: Store management and visit tracking
 */

/**
 * @openapi
 * /api/stores:
 *   get:
 *     summary: Get all stores
 *     tags: [Stores]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: companyId
 *         schema: { type: string }
 *       - in: query
 *         name: area
 *         schema: { type: string }
 *     responses:
 *       200: { description: Success }
 *   post:
 *     summary: Create a new store
 *     tags: [Stores]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Created } }
 * /api/stores/{id}:
 *   get:
 *     summary: Get store by ID
 *     tags: [Stores]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Success } }
 *   put:
 *     summary: Update store
 *     tags: [Stores]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Success } }
 *   delete:
 *     summary: Delete store
 *     tags: [Stores]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Deleted } }
 * /api/stores/visit:
 *   post:
 *     summary: Log a store visit
 *     tags: [Stores]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Created } }
 * /api/stores/visit/{id}:
 *   put:
 *     summary: Update visit log
 *     tags: [Stores]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Success } }
 *   delete:
 *     summary: Delete visit log
 *     tags: [Stores]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Deleted } }
 * /api/stores/{storeId}/visits:
 *   get:
 *     summary: Get visit history for a store
 *     tags: [Stores]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: storeId, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Success } }
 */

// Get list of all stores (filtered by company and area)
router.get('/', authenticate, checkPermission('mod_stores', 'canRead'), storeController.getAllStores);

// Create a new store (shop profile)
router.post('/', authenticate, checkPermission('mod_stores', 'canCreate'), storeController.createStore);

// Get a single store by ID
router.get('/:id', authenticate, checkPermission('mod_stores', 'canRead'), storeController.getStoreById);

// Update store details
router.put('/:id', authenticate, checkPermission('mod_stores', 'canEdit'), storeController.updateStore);

// Log a visit to a store
router.post('/visit', authenticate, checkPermission('mod_stores', 'canCreate'), storeController.addStoreLog);

// Update a visit log
router.put('/visit/:id', authenticate, checkPermission('mod_stores', 'canEdit'), storeController.updateStoreVisit);

// Delete a visit log
router.delete('/visit/:id', authenticate, checkPermission('mod_stores', 'canDelete'), storeController.deleteStoreVisit);

// Get visit history for a specific store
router.get('/:storeId/visits', authenticate, checkPermission('mod_stores', 'canRead'), storeController.getStoreVisits);

// Delete a store and its history
router.delete('/:id', authenticate, checkPermission('mod_stores', 'canDelete'), storeController.deleteStore);

export default router;
