import { Router } from 'express';
import * as authController from '../controllers/auth/authController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

/**
 * @openapi
 * /api/auth/login:
 *   post: { summary: Login, tags: [Authentication], responses: { 200: { description: Token returned } } }
 * /api/auth/register:
 *   post: { summary: Register, tags: [Authentication], responses: { 201: { description: User created } } }
 * /api/auth/me:
 *   get: { summary: Get session status, tags: [Authentication], responses: { 200: { description: User profile } } }
 */
router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/reset-password', authController.resetPasswordDirect);
router.get('/me', authenticate as any, authController.getMe);

export default router;
