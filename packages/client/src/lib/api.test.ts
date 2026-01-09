import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock import.meta.env before importing the module
const mockEnv: { VITE_API_URL?: string } = {};

vi.mock('import.meta', () => ({
  env: mockEnv
}));

// We need to re-import after mocking
describe('api', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('when API_BASE_URL is set', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
    });

    it('makes a request to the correct endpoint', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ version: '1.0.0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      const result = await api.ping.get();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/ping',
        undefined
      );
      expect(result).toEqual({ version: '1.0.0' });
    });

    it('throws error when response is not ok', async () => {
      vi.mocked(global.fetch).mockResolvedValue(new Response(null, { status: 500 }));

      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow('API error: 500');
    });

    it('handles 404 errors', async () => {
      vi.mocked(global.fetch).mockResolvedValue(new Response(null, { status: 404 }));

      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow('API error: 404');
    });

    it('handles network errors', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow('Network error');
    });
  });

  describe('when API_BASE_URL is not set', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_URL', '');
    });

    it('throws error when VITE_API_URL is not set', async () => {
      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow(
        'VITE_API_URL environment variable is not set'
      );
    });
  });

  describe('API_BASE_URL export', () => {
    it('exports the API_BASE_URL', async () => {
      vi.stubEnv('VITE_API_URL', 'http://test-api.com');

      const { API_BASE_URL } = await import('./api');

      expect(API_BASE_URL).toBe('http://test-api.com');
    });
  });
});
