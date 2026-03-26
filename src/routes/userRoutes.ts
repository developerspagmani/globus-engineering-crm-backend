import { Router } from 'express';
import * as userController from '../controllers/user/userController';
import { authorize } from '../middleware/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/users:
 *   get: { summary: Get all users, tags: [Administration], responses: { 200: { description: List of users } } }
 *   post: { summary: Create user, tags: [Administration], responses: { 201: { description: Created } } }
 * /api/users/{id}/permissions:
 *   patch: { summary: Update user permissions, tags: [Administration], responses: { 200: { description: Updated } } }
 */
router.get('/users', authorize(['super_admin', 'admin', 'company_admin']) as any, userController.getAllUsers);
router.post('/users', authorize(['super_admin', 'admin', 'company_admin']) as any, userController.createUser);
router.patch('/users/:id/permissions', authorize(['super_admin', 'admin']) as any, userController.updateUserPermissions);

export default router;
