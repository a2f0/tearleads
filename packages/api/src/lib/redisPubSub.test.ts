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

describe('Redis PubSub Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(async () => {
    vi.resetModules();
  });

  describe('getRedisSubscriberClient', () => {
    it('creates a new subscriber client on first call', async () => {
      const { getRedisSubscriberClient } = await import('./redisPubSub.js');
      mockConnect.mockResolvedValue(undefined);

      await getRedisSubscriberClient();

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('registers error handler that logs errors', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const { getRedisSubscriberClient } = await import('./redisPubSub.js');
      mockConnect.mockResolvedValue(undefined);

      await getRedisSubscriberClient();

      const errorHandler = mockOn.mock.calls.find(
        (call) => call[0] === 'error'
      )?.[1];
      expect(errorHandler).toBeDefined();

      const testError = new Error('Test Redis subscriber error');
      errorHandler(testError);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Redis subscriber client error:',
        testError
      );
      consoleSpy.mockRestore();
    });

    it('reuses existing subscriber client on subsequent calls', async () => {
      const { getRedisSubscriberClient } = await import('./redisPubSub.js');
      mockConnect.mockResolvedValue(undefined);

      const client1 = await getRedisSubscriberClient();
      const client2 = await getRedisSubscriberClient();

      expect(client1).toBe(client2);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('closeRedisSubscriberClient', () => {
    it('closes the subscriber client if it exists', async () => {
      const { getRedisSubscriberClient, closeRedisSubscriberClient } =
        await import('./redisPubSub.js');
      mockConnect.mockResolvedValue(undefined);
      mockQuit.mockResolvedValue(undefined);

      await getRedisSubscriberClient();
      await closeRedisSubscriberClient();

      expect(mockQuit).toHaveBeenCalledTimes(1);
    });

    it('does nothing if no subscriber client exists', async () => {
      const { closeRedisSubscriberClient } = await import('./redisPubSub.js');

      await closeRedisSubscriberClient();

      expect(mockQuit).not.toHaveBeenCalled();
    });

    it('allows creating a new subscriber client after closing', async () => {
      const { getRedisSubscriberClient, closeRedisSubscriberClient } =
        await import('./redisPubSub.js');
      mockConnect.mockResolvedValue(undefined);
      mockQuit.mockResolvedValue(undefined);

      await getRedisSubscriberClient();
      await closeRedisSubscriberClient();
      await getRedisSubscriberClient();

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });
});
