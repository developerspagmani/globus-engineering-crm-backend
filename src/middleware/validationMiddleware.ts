
import { Request, Response, NextFunction } from 'express';
import { validateData, Schema } from '../utils/validationSchemas';

export const validateRequest = (schema: Schema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // If it's a GET request with query params, validate req.query if needed
    // But usually we validate req.body for POST/PUT
    const dataToValidate = req.method === 'GET' ? req.query : req.body;
    
    if (!dataToValidate || Object.keys(dataToValidate).length === 0) {
      if (req.method !== 'GET') {
         return res.status(400).json({ error: 'Request body is empty' });
      }
    }

    const { isValid, errors } = validateData(dataToValidate, schema);

    if (!isValid) {
      console.warn(`[VALIDATION FAILED] ${req.method} ${req.originalUrl}:`, errors);
      return res.status(400).json({ 
        error: 'Validation Failed', 
        details: errors 
      });
    }

    next();
  };
};
