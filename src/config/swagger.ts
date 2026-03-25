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
      {
        url: 'http://localhost:4000',
        description: 'Development server (Localhost)',
      },
      {
        url: 'https://globus-engineering-crm-backend.vercel.app',
        description: 'Production server (Vercel)',
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
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'], // Path to the API docs
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
