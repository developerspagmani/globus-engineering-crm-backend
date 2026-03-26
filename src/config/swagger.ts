import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Globus Engineering CRM API',
      version: '1.0.0',
      description: 'API documentation for the Globus Engineering CRM system handling industrial tenants and logistics.',
      contact: {
        name: 'Globus Support',
      },
    },
    servers: [
      process.env.NODE_ENV == "production" ?
      {
        url: 'https://globus-engineering-crm-backend.vercel.app',
        description: 'Production server (Vercel)',
      }
      :
      {
        url: 'http://localhost:3001',
        description: 'Development server (Localhost)',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: ['./src/routes/*.{ts,js}', './src/index.{ts,js}'], // Path to the API docs
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
