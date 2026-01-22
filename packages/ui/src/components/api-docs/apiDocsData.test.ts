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
          },
          {
            name: 'schemaRef',
            in: 'query',
            required: false,
            schema: {
              $ref: '#/components/schemas/SchemaRef'
            }
          },
          {
            name: 'flag',
            in: 'query',
            required: false
          }
        ],
        responses: {
          '200': {
            description: 'OK'
          }
        }
      }
    },
    '/auth/register': {
      post: {
        operationId: 'registerUser',
        tags: ['Auth'],
        requestBody: {
          $ref: '#/components/requestBodies/Register'
        },
        responses: {
          '201': {
            description: 'Created'
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
    },
    '/duplicate': {
      post: {
        operationId: 'loginUser',
        tags: ['Auth'],
        responses: {
          '202': {
            description: 'Accepted'
          }
        }
      }
    },
    '/duplicate-2': {
      post: {
        operationId: 'loginUser',
        tags: ['Auth'],
        responses: {
          '203': {
            description: 'Accepted later'
          }
        }
      }
    },
    '/no-responses': {
      get: {
        responses: {}
      }
    },
    '/ref': {
      $ref: '#/components/pathItems/Ref'
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
    expect(result.totalOperations).toBe(7);
    const [authGroup, generalGroup] = result.tagGroups;
    expect(authGroup).toBeDefined();
    expect(generalGroup).toBeDefined();
    if (!authGroup || !generalGroup) {
      throw new Error('Expected tag groups for Auth and General');
    }

    expect(authGroup.name).toBe('Auth');
    expect(authGroup.operations).toHaveLength(4);
    expect(generalGroup.name).toBe('General');
    expect(generalGroup.operations).toHaveLength(3);
  });

  it('exposes operation metadata', () => {
    const result = buildApiDocsData(spec, {
      fallbackTag: 'General'
    });

    const login = result.tagGroups
      .flatMap((group) => group.operations)
      .find((operation) => operation.path === '/auth/login');

    expect(login).toBeDefined();
    if (!login) {
      throw new Error('Expected /auth/login operation');
    }

    expect(login.summary).toBe('loginUser');
    expect(login.requestBody?.contentTypes).toContain('application/json');
    const [loginParameter] = login.parameters;
    const [loginResponse] = login.responses;
    expect(loginParameter).toBeDefined();
    expect(loginResponse).toBeDefined();
    if (!loginParameter || !loginResponse) {
      throw new Error('Expected login parameters and responses');
    }

    expect(loginParameter.schemaType).toBe('string');
    expect(loginResponse.status).toBe('200');

    const health = result.tagGroups
      .flatMap((group) => group.operations)
      .find((operation) => operation.path === '/health');

    expect(health).toBeDefined();
    if (!health) {
      throw new Error('Expected /health operation');
    }

    expect(health.deprecated).toBe(true);
    expect(health.summary).toBe('Health check');
  });

  it('handles references and fallback summaries', () => {
    const result = buildApiDocsData(
      {
        openapi: '3.0.0',
        info: {
          title: 'No servers',
          version: '0.0.0'
        },
        paths: {
          ...spec.paths,
          '/fallback': {
            get: {
              responses: {}
            }
          }
        }
      },
      {
        fallbackTag: 'General'
      }
    );

    const register = result.tagGroups
      .flatMap((group) => group.operations)
      .find((operation) => operation.path === '/auth/register');

    expect(register).toBeDefined();
    if (!register) {
      throw new Error('Expected /auth/register operation');
    }

    expect(register.requestBody?.ref).toBe(
      '#/components/requestBodies/Register'
    );

    const status = result.tagGroups
      .flatMap((group) => group.operations)
      .find((operation) => operation.path === '/status');

    expect(status).toBeDefined();
    if (!status) {
      throw new Error('Expected /status operation');
    }

    const [statusResponse] = status.responses;
    const [statusParameter] = status.parameters;
    expect(statusResponse).toBeDefined();
    expect(statusParameter).toBeDefined();
    if (!statusResponse || !statusParameter) {
      throw new Error('Expected /status responses and parameters');
    }

    expect(statusResponse.ref).toBe('#/components/responses/StatusOk');
    expect(statusParameter.ref).toBe(
      '#/components/parameters/CorrelationId'
    );

    const fallback = result.tagGroups
      .flatMap((group) => group.operations)
      .find((operation) => operation.path === '/fallback');

    expect(fallback).toBeDefined();
    if (!fallback) {
      throw new Error('Expected /fallback operation');
    }

    expect(fallback.summary).toBe('GET /fallback');
  });
});
