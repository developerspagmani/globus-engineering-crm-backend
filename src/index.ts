import express from 'express';
// Force reload of remote database config
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes';
import prisma from './config/prisma';
import EmailReminderService from './services/emailReminderService';


dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({
  origin: '*', // Allow all for troubleshooting, can restrict later
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Globus Engineering CRM Backend API',
    version: '1.0.0',
    endpoints: {
      api: '/api'
    }
  });
});

// Main API Routes
app.use('/api', apiRoutes);

// Initial Database connection test removed from server start for serverless compatibility.
// Serverless functions start up quickly; Prisma handles connections on the first query.

if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 MVC Backend running on http://localhost:${PORT}`);
    
    // Start email reminder cron job
    const emailService = EmailReminderService.getInstance();
    emailService.startCronJob();
  });
}


// 404 Catch-all - Ensure undefined routes return JSON
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// Global Error Handler - Ensure all errors return JSON (prevents "Unexpected token <" in frontend)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Server Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    detail: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

export default app;
