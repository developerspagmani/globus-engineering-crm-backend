import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes';
import prisma from './config/prisma';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: '*', // Allow all for troubleshooting, can restrict later
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
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

// Swagger Documentation with CDN assets for Vercel support
const CSS_URL = "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui.min.css";
const JS_URLS = [
  "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-bundle.js",
  "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui-standalone-preset.js"
];
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customCssUrl: CSS_URL,
  customJs: JS_URLS,
  customSiteTitle: 'Globus CRM API Documentation'
}));

// Initial Database connection test removed from server start for serverless compatibility.
// Serverless functions start up quickly; Prisma handles connections on the first query.

if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 MVC Backend running on http://localhost:${PORT}`);
  });
}

export default app;
