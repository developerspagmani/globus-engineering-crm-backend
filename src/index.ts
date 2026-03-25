import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes';
import prisma from './config/prisma';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Globus Engineering CRM Backend API',
    version: '1.0.0',
    endpoints: {
      api: '/api',
      docs: '/api-docs'
    }
  });
});

// Main API Routes
app.use('/api', apiRoutes);

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Initial Database connection test removed from server start for serverless compatibility.
// Serverless functions start up quickly; Prisma handles connections on the first query.

if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 MVC Backend running on http://localhost:${PORT}`);
  });
}

export default app;
