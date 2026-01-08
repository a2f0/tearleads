import swaggerJsdoc from 'swagger-jsdoc';
import packageJson from '../package.json' with { type: 'json' };

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Rapid API',
      version: packageJson.version,
      description: 'API documentation for Rapid'
    },
    servers: [
      {
        url: 'http://localhost:5001/v1',
        description: 'Development server'
      }
    ]
  },
  apis: ['./src/**/*.ts']
};

export const openapiSpecification = swaggerJsdoc(options);
