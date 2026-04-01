import express from 'express';
import * as storeController from '../controllers/stores/storeController';
import { authenticate } from '../middleware/authMiddleware';

const router = express.Router();

// Get list of all stores (filtered by company and area)
router.get('/', authenticate, storeController.getAllStores);

// Create a new store (shop profile)
router.post('/', authenticate, storeController.createStore);

// Get a single store by ID
router.get('/:id', authenticate, storeController.getStoreById);

// Update store details
router.put('/:id', authenticate, storeController.updateStore);

// Log a visit to a store
router.post('/visit', authenticate, storeController.addStoreLog);

// Update a visit log
router.put('/visit/:id', authenticate, storeController.updateStoreVisit);

// Delete a visit log
router.delete('/visit/:id', authenticate, storeController.deleteStoreVisit);

// Get visit history for a specific store
router.get('/:storeId/visits', authenticate, storeController.getStoreVisits);

// Delete a store and its history
router.delete('/:id', authenticate, storeController.deleteStore);

export default router;
