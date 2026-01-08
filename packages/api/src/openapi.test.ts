import { describe, expect, it } from 'vitest';
import { openapiSpecification } from './openapi.js';

describe('OpenAPI Specification', () => {
  it('should generate valid OpenAPI 3.0 spec', () => {
    expect(openapiSpecification).toHaveProperty('openapi', '3.0.0');
    expect(openapiSpecification).toHaveProperty('info');
    expect(openapiSpecification).toHaveProperty('paths');
  });

  it('should include API info', () => {
    const info = openapiSpecification.info as {
      title: string;
      version: string;
      description: string;
    };
    expect(info.title).toBe('Rapid API');
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(info.description).toBe('API documentation for Rapid');
  });

  it('should include ping endpoint', () => {
    const paths = openapiSpecification.paths as Record<string, unknown>;
    expect(paths).toHaveProperty('/ping');
  });

  it('should include component schemas', () => {
    const components = openapiSpecification.components as {
      schemas: Record<string, unknown>;
    };
    expect(components.schemas).toHaveProperty('PingData');
    expect(components.schemas).toHaveProperty('Error');
  });
});
