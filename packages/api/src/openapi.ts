import type { OpenAPIV3 } from 'openapi-types';
import swaggerJsdoc from 'swagger-jsdoc';
import packageJson from '../package.json' with { type: 'json' };

const DEV_API_URL = 'http://localhost:5001/v1';
const apiUrl = process.env['VITE_API_URL'] || DEV_API_URL;
const isProduction = apiUrl !== DEV_API_URL;

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
        url: apiUrl,
        description: isProduction ? 'Production server' : 'Development server'
      }
    ]
  },
  apis: ['./src/**/*.ts']
};

const generatedSpec = swaggerJsdoc(options);
if (!isOpenApiV3Document(generatedSpec)) {
  throw new Error('Generated OpenAPI specification is not v3');
}
export const openapiSpecification: OpenAPIV3.Document = generatedSpec;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOpenApiV3Document(
  value: unknown
): value is OpenAPIV3.Document {
  return isRecord(value) && typeof value.openapi === 'string';
}
