import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'globus_crm_secret_key_2024';
const IS_AUTH_ENABLED = process.env.AUTH !== 'false'; // Enabled by default unless explicitly 'false'

export interface ModulePermission {
  moduleId: string;
  canRead: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'super_admin' | 'company_admin' | 'admin' | 'sales' | 'staff';
    company_id: string | null;
    module_permissions?: ModulePermission[];
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  // Global Auth Toggle Check
  if (!IS_AUTH_ENABLED) {
    return next();
  }

  const authHeader = req.headers.authorization;
  // console.log('--- AUTHENTICATION CHECK ---');
  // console.log('Auth Header:', authHeader ? 'Present' : 'MISSING');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('Auth Failure: No Bearer token provided');
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    // console.log('--- AUTHENTICATE MIDDLEWARE ATTACHING USER ---');
    // console.log('Decoded Token Keys:', Object.keys(decoded));
    // console.log('User ID:', decoded.id, 'Email:', decoded.email, 'CompID:', decoded.company_id || decoded.companyId);
    req.user = decoded;
    next();
  } catch (error: any) {
    console.error('Token Verification Failed:', error.message);
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

/**
 * Role-based authorization middleware
 */
export const authorize = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    // Global Auth Toggle Check
    if (!IS_AUTH_ENABLED) {
      return next();
    }

    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to view this resource.' });
    }
    next();
  };
};

/**
 * Granular Permission-based middleware
 */
export const checkPermission = (moduleId: string, action: 'canRead' | 'canCreate' | 'canEdit' | 'canDelete') => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    // Global Auth Toggle Check
    if (!IS_AUTH_ENABLED) {
      return next();
    }

    let user = req.user;

    // Fallback: If global authenticate didn't run or failed to attach, try to decode locally
    if (!user) {
      console.warn(`[AUTH DEBUG] User missing in checkPermission for ${moduleId}. Attempting local decode...`);
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          user = jwt.verify(token, JWT_SECRET) as any;
          (req as any).user = user;
          console.log(`[AUTH DEBUG] Local decode successful for ${user?.email}`);
        } catch (e) {
          console.error(`[AUTH DEBUG] Local decode FAILED.`);
        }
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized - No valid user session found' });
    }

    // Admins have bypass for everything
    if (user.role === 'super_admin' || user.role === 'company_admin') {
      return next();
    }

    // Find the permission for the specific module
    const permission = user.module_permissions?.find((p) => p.moduleId === moduleId || p.moduleId === 'all');

    if (!permission || !permission[action]) {
      return res.status(403).json({ 
        error: `Access Denied. You do not have ${action.replace('can', '').toLowerCase()} permission for the ${moduleId} module.` 
      });
    }

    next();
  };
};
