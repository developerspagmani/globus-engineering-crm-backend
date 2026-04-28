import { Router } from 'express';
import * as migrationController from '../controllers/admin/migrationController';

const router = Router();

// Migration Routes
router.post('/migration/migrate', migrationController.migrateLegacyData as any);
router.post('/migration/rollback', migrationController.rollbackLegacyMigration as any);

export default router;
