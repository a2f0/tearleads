import { describe, expect, it } from 'vitest';
import { openapiSpecification } from './openapi.js';

describe('OpenAPI Specification', () => {
  it('should generate valid OpenAPI 3.0 spec', () => {
    expect(openapiSpecification).toHaveProperty('openapi', '3.0.0');
    expect(openapiSpecification).toHaveProperty('info');
    expect(openapiSpecification).toHaveProperty('paths');
  });

  it('should include API info', () => {
    expect(openapiSpecification.info.title).toBe('Rapid API');
    expect(openapiSpecification.info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(openapiSpecification.info.description).toBe(
      'API documentation for Rapid'
    );
  });

  it('should include ping endpoint', () => {
    expect(openapiSpecification.paths).toHaveProperty('/ping');
  });

  it('should include component schemas', () => {
    expect(openapiSpecification.components?.schemas).toHaveProperty('PingData');
    expect(openapiSpecification.components?.schemas).toHaveProperty('Error');
  });
});
