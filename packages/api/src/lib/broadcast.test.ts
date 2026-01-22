import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BroadcastMessage } from './broadcast.js';
import type { RedisClient } from './redis.js';

// Type guard for test mocks
function isRedisClient(obj: unknown): obj is RedisClient {
  return obj !== null && typeof obj === 'object';
}

const mockPublish = vi.fn();

function createMockClient(): RedisClient {
  const mock = { publish: mockPublish };
  if (!isRedisClient(mock)) throw new Error('Invalid mock');
  return mock;
}

vi.mock('./redis.js', () => ({
  getRedisClient: vi.fn(() => Promise.resolve(createMockClient()))
}));

describe('broadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes a message to the specified channel', async () => {
    const { broadcast } = await import('./broadcast.js');
    mockPublish.mockResolvedValue(1);

    const message: BroadcastMessage = {
      type: 'test',
      payload: { foo: 'bar' },
      timestamp: '2024-01-01T00:00:00.000Z'
    };

    const result = await broadcast('test-channel', message);

    expect(mockPublish).toHaveBeenCalledWith(
      'test-channel',
      JSON.stringify(message)
    );
    expect(result).toBe(1);
  });

  it('serializes complex payloads correctly', async () => {
    const { broadcast } = await import('./broadcast.js');
    mockPublish.mockResolvedValue(2);

    const message: BroadcastMessage = {
      type: 'complex',
      payload: {
        nested: {
          array: [1, 2, 3],
          bool: true
        }
      },
      timestamp: '2024-01-01T00:00:00.000Z'
    };

    await broadcast('complex-channel', message);

    expect(mockPublish).toHaveBeenCalledWith(
      'complex-channel',
      JSON.stringify(message)
    );
  });

  it('returns the number of subscribers that received the message', async () => {
    const { broadcast } = await import('./broadcast.js');
    mockPublish.mockResolvedValue(5);

    const message: BroadcastMessage = {
      type: 'test',
      payload: null,
      timestamp: '2024-01-01T00:00:00.000Z'
    };

    const result = await broadcast('broadcast', message);

    expect(result).toBe(5);
  });
});
