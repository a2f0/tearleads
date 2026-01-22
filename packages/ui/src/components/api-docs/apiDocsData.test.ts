import type { OpenAPIV3 } from 'openapi-types';
import { describe, expect, it } from 'vitest';
import { buildApiDocsData } from './apiDocsData.js';

const spec: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'Rapid API',
    version: '1.0.0'
  },
  servers: [{ url: 'https://api.rapid.local' }],
  tags: [
    {
      name: 'Auth',
      description: 'Authentication endpoints'
    }
  ],
  paths: {
    '/auth/login': {
      post: {
        operationId: 'loginUser',
        tags: ['Auth'],
        requestBody: {
          description: 'Login payload',
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object'
              }
            }
          }
        },
        parameters: [
          {
            name: 'traceId',
            in: 'header',
            required: true,
            description: 'Trace header',
            schema: {
              type: 'string'
            }
          }
        ],
        responses: {
          '200': {
            description: 'OK'
          }
        }
      }
    },
    '/status': {
      get: {
        responses: {
          '200': {
            $ref: '#/components/responses/StatusOk'
          }
        }
      },
      parameters: [
        {
          $ref: '#/components/parameters/CorrelationId'
        }
      ]
    },
    '/health': {
      get: {
        summary: 'Health check',
        deprecated: true,
        responses: {
          '204': {
            description: 'No content'
          }
        }
      }
    }
  }
};

describe('buildApiDocsData', () => {
  it('groups operations by tag and applies fallback tag', () => {
    const result = buildApiDocsData(spec, {
      fallbackTag: 'General',
      tagOrder: ['Auth', 'General']
    });

    expect(result.baseUrl).toBe('https://api.rapid.local');
    expect(result.totalOperations).toBe(3);
    expect(result.tagGroups[0].name).toBe('Auth');
    expect(result.tagGroups[0].operations).toHaveLength(1);
    expect(result.tagGroups[1].name).toBe('General');
    expect(result.tagGroups[1].operations).toHaveLength(2);
  });

  it('exposes operation metadata', () => {
    const result = buildApiDocsData(spec, {
      fallbackTag: 'General'
    });

    const login = result.tagGroups
      .flatMap((group) => group.operations)
      .find((operation) => operation.path === '/auth/login');

    expect(login?.summary).toBe('loginUser');
    expect(login?.requestBody?.contentTypes).toContain('application/json');
    expect(login?.parameters[0].schemaType).toBe('string');
    expect(login?.responses[0].status).toBe('200');

    const health = result.tagGroups
      .flatMap((group) => group.operations)
      .find((operation) => operation.path === '/health');

    expect(health?.deprecated).toBe(true);
    expect(health?.summary).toBe('Health check');
  });
});
