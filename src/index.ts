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

// Main API Routes
app.use('/api', apiRoutes);

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Start Server
app.listen(PORT, async () => {
  console.log(`🚀 MVC Backend running on http://localhost:${PORT}`);
  console.log('DEBUG: SERVER RESTARTED - LOADED VERSION 2');
  try {
    await prisma.$connect();
    console.log('✅ Connected to Database via Prisma');
  } catch (err) {
    console.error('❌ Database connection failed:', err);
  }
});

export default app;
