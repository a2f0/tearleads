import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockConnect = vi.fn();
const mockQuit = vi.fn();
const mockOn = vi.fn();

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    connect: mockConnect,
    quit: mockQuit,
    on: mockOn
  }))
}));

describe('Redis Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(async () => {
    vi.resetModules();
  });

  describe('getRedisClient', () => {
    it('creates a new client on first call', async () => {
      const { getRedisClient } = await import('./client.js');
      mockConnect.mockResolvedValue(undefined);

      await getRedisClient();

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('registers error handler that logs errors', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const { getRedisClient } = await import('./client.js');
      mockConnect.mockResolvedValue(undefined);

      await getRedisClient();

      const errorHandler = mockOn.mock.calls.find(
        (call) => call[0] === 'error'
      )?.[1] as (err: Error) => void;
      expect(errorHandler).toBeDefined();

      const testError = new Error('Test Redis error');
      errorHandler(testError);

      expect(consoleSpy).toHaveBeenCalledWith('Redis client error:', testError);
      consoleSpy.mockRestore();
    });

    it('reuses existing client on subsequent calls', async () => {
      const { getRedisClient } = await import('./client.js');
      mockConnect.mockResolvedValue(undefined);

      const client1 = await getRedisClient();
      const client2 = await getRedisClient();

      expect(client1).toBe(client2);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('creates new client when URL changes', async () => {
      const { getRedisClient } = await import('./client.js');
      mockConnect.mockResolvedValue(undefined);
      mockQuit.mockResolvedValue(undefined);

      await getRedisClient('redis://localhost:6379');
      await getRedisClient('redis://localhost:6380');

      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('uses custom URL when provided', async () => {
      const { createClient } = await import('redis');
      const { getRedisClient } = await import('./client.js');
      mockConnect.mockResolvedValue(undefined);

      await getRedisClient('redis://custom:1234');

      expect(createClient).toHaveBeenCalledWith({ url: 'redis://custom:1234' });
    });
  });

  describe('closeRedisClient', () => {
    it('closes the client if it exists', async () => {
      const { getRedisClient, closeRedisClient } = await import('./client.js');
      mockConnect.mockResolvedValue(undefined);
      mockQuit.mockResolvedValue(undefined);

      await getRedisClient();
      await closeRedisClient();

      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('does nothing if no client exists', async () => {
      const { closeRedisClient } = await import('./client.js');

      await closeRedisClient();

      expect(mockQuit).not.toHaveBeenCalled();
    });

    it('allows creating a new client after closing', async () => {
      const { getRedisClient, closeRedisClient } = await import('./client.js');
      mockConnect.mockResolvedValue(undefined);
      mockQuit.mockResolvedValue(undefined);

      await getRedisClient();
      await closeRedisClient();
      await getRedisClient();

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });
});
