import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('OpenAPI Specification', () => {
  describe('with default (development) settings', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.stubEnv('VITE_API_URL', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should generate valid OpenAPI 3.0 spec', async () => {
      const { openapiSpecification } = await import('./openapi.js');
      expect(openapiSpecification).toHaveProperty('openapi', '3.0.0');
      expect(openapiSpecification).toHaveProperty('info');
      expect(openapiSpecification).toHaveProperty('paths');
    });

    it('should include API info', async () => {
      const { openapiSpecification } = await import('./openapi.js');
      expect(openapiSpecification.info.title).toBe('Rapid API');
      expect(openapiSpecification.info.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(openapiSpecification.info.description).toBe(
        'API documentation for Rapid'
      );
    });

    it('should include ping endpoint', async () => {
      const { openapiSpecification } = await import('./openapi.js');
      expect(openapiSpecification.paths).toHaveProperty('/ping');
    });

    it('should include component schemas', async () => {
      const { openapiSpecification } = await import('./openapi.js');
      expect(openapiSpecification.components?.schemas).toHaveProperty(
        'PingData'
      );
      expect(openapiSpecification.components?.schemas).toHaveProperty('Error');
    });

    it('should use development server URL when VITE_API_URL not set', async () => {
      const { openapiSpecification } = await import('./openapi.js');
      expect(openapiSpecification.servers?.[0]).toEqual({
        url: 'http://localhost:5001/v1',
        description: 'Development server'
      });
    });
  });

  describe('with VITE_API_URL set', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.stubEnv('VITE_API_URL', 'https://api.example.com/v1');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should use production server URL from VITE_API_URL', async () => {
      const { openapiSpecification } = await import('./openapi.js');
      expect(openapiSpecification.servers?.[0]).toEqual({
        url: 'https://api.example.com/v1',
        description: 'Production server'
      });
    });
  });

  describe('with invalid OpenAPI output', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.doUnmock('swagger-jsdoc');
    });

    it('throws when swagger-jsdoc returns non-v3 spec', async () => {
      vi.doMock('swagger-jsdoc', () => ({
        default: () => ({ openapi: '2.0.0' })
      }));

      await expect(import('./openapi.js')).rejects.toThrow(
        'Generated OpenAPI specification is not v3'
      );
    });
  });
});
