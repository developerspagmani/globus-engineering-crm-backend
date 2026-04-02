import { Router } from 'express';
import * as userController from '../controllers/user/userController';
import { authorize } from '../middleware/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/users:
 *   get:
 *     summary: Get all users
 *     tags: [Administration]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: List of users } }
 *   post:
 *     summary: Create user
 *     tags: [Administration]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Created } }
 * /api/users/{id}:
 *   put:
 *     summary: Update user
 *     tags: [Administration]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Updated } }
 *   delete:
 *     summary: Delete user
 *     tags: [Administration]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Deleted } }
 * /api/users/{id}/permissions:
 *   patch:
 *     summary: Update user permissions
 *     tags: [Administration]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Updated } }
 * /api/users/{id}/reset-password:
 *   put:
 *     summary: Reset user password
 *     tags: [Administration]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses: { 200: { description: Password updated } }
 */
router.get('/users', authorize(['super_admin', 'admin', 'company_admin']) as any, userController.getAllUsers);
router.post('/users', authorize(['super_admin', 'admin', 'company_admin']) as any, userController.createUser);
router.patch('/users/:id/permissions', authorize(['super_admin', 'admin']) as any, userController.updateUserPermissions);
router.put('/users/:id', authorize(['super_admin', 'admin', 'company_admin']) as any, userController.updateUser);
router.put('/users/:id/reset-password', authorize(['super_admin', 'admin', 'company_admin']) as any, userController.resetPassword);
router.delete('/users/:id', authorize(['super_admin', 'admin', 'company_admin']) as any, userController.deleteUser);

export default router;
