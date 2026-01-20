import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock import.meta.env before importing the module
const mockEnv: { VITE_API_URL?: string } = {};

vi.mock('import.meta', () => ({
  env: mockEnv
}));

// Mock analytics to capture logged event names
const mockLogApiEvent = vi.fn();
vi.mock('@/db/analytics', () => ({
  logApiEvent: (...args: unknown[]) => mockLogApiEvent(...args)
}));

// We need to re-import after mocking
describe('api', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = vi.fn();
    mockLogApiEvent.mockResolvedValue(undefined);
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
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(null, { status: 500 })
      );

      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow('API error: 500');
    });

    it('handles 404 errors', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(null, { status: 404 })
      );

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

  describe('event name generation', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_API_URL', 'http://localhost:3000');
    });

    it('strips query parameters from event name for paginated requests', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ keys: [], nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.redis.getKeys('someCursor123', 50);

      // Event name should be api_get_admin_redis_keys, not api_get_admin_redis_keys?cursor=someCursor123&limit=50
      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_keys',
        expect.any(Number),
        true
      );
    });

    it('logs correct event name for simple endpoints', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ version: '1.0.0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.ping.get();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_ping',
        expect.any(Number),
        true
      );
    });

    it('logs success=false for failed requests', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(null, { status: 500 })
      );

      const { api } = await import('./api');

      await expect(api.ping.get()).rejects.toThrow();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_ping',
        expect.any(Number),
        false
      );
    });

    it('uses generic event name for getValue without leaking key values', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({ key: 'sessions:abc123', value: 'test', ttl: -1 }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      await api.admin.redis.getValue('sessions:abc123');

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_key',
        expect.any(Number),
        true
      );
    });

    it('uses generic event name for deleteKey without leaking key values', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.redis.deleteKey('users:user-uuid:sessions');

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_delete_admin_redis_key',
        expect.any(Number),
        true
      );
    });

    it('logs the dbsize endpoint event', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ count: 123 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.redis.getDbSize();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_redis_dbsize',
        expect.any(Number),
        true
      );
    });

    it('logs the postgres info endpoint event', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({ status: 'ok', info: {}, serverVersion: null }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      );

      const { api } = await import('./api');
      await api.admin.postgres.getInfo();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_postgres_info',
        expect.any(Number),
        true
      );
    });

    it('logs the postgres tables endpoint event', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ tables: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.postgres.getTables();

      expect(mockLogApiEvent).toHaveBeenCalledWith(
        'api_get_admin_postgres_tables',
        expect.any(Number),
        true
      );
    });

    it('handles getKeys without pagination params', async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response(JSON.stringify({ keys: [], nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const { api } = await import('./api');
      await api.admin.redis.getKeys();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/admin/redis/keys',
        undefined
      );
    });
  });
});
