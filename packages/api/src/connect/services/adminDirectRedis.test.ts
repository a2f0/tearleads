import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getRedisClientMock, requireAdminSessionMock } = vi.hoisted(() => ({
  getRedisClientMock: vi.fn(),
  requireAdminSessionMock: vi.fn()
}));

vi.mock('@tearleads/shared/redis', () => ({
  getRedisClient: (...args: unknown[]) => getRedisClientMock(...args)
}));

vi.mock('./adminDirectAuth.js', async () => {
  const actual = await vi.importActual<typeof import('./adminDirectAuth.js')>(
    './adminDirectAuth.js'
  );
  return {
    ...actual,
    requireAdminSession: (...args: unknown[]) =>
      requireAdminSessionMock(...args)
  };
});

import {
  deleteRedisKeyDirect,
  getRedisDbSizeDirect,
  getRedisKeysDirect,
  getRedisValueDirect
} from './adminDirectRedis.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new Error('Expected object JSON response');
  }
  return parsed;
}

describe('adminDirectRedis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSessionMock.mockReset();
    getRedisClientMock.mockReset();

    requireAdminSessionMock.mockResolvedValue({
      sub: 'admin-1'
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('lists redis keys and expands type/ttl metadata', async () => {
    const scanMock = vi.fn().mockResolvedValue({
      cursor: '7',
      keys: ['key-1', 'key-2']
    });
    const execMock = vi.fn().mockResolvedValue(['string', 60, 'set', -1]);
    const typeMock = vi.fn().mockReturnThis();
    const ttlMock = vi.fn().mockReturnThis();

    getRedisClientMock.mockResolvedValue({
      scan: scanMock,
      multi: vi.fn(() => ({
        type: typeMock,
        ttl: ttlMock,
        exec: execMock
      }))
    });

    const response = await getRedisKeysDirect(
      {
        cursor: '',
        limit: 0
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(requireAdminSessionMock).toHaveBeenCalledWith(
      '/admin/redis/keys',
      expect.any(Headers)
    );
    expect(scanMock).toHaveBeenCalledWith('0', {
      MATCH: '*',
      COUNT: 50
    });
    expect(typeMock).toHaveBeenCalledWith('key-1');
    expect(typeMock).toHaveBeenCalledWith('key-2');
    expect(ttlMock).toHaveBeenCalledWith('key-1');
    expect(ttlMock).toHaveBeenCalledWith('key-2');

    expect(parseJson(response.json)).toEqual({
      keys: [
        { key: 'key-1', type: 'string', ttl: 60 },
        { key: 'key-2', type: 'set', ttl: -1 }
      ],
      cursor: '7',
      hasMore: true
    });
  });

  it('handles empty key pages without pipeline execution', async () => {
    const multiMock = vi.fn();
    getRedisClientMock.mockResolvedValue({
      scan: vi.fn().mockResolvedValue({
        cursor: '0',
        keys: []
      }),
      multi: multiMock
    });

    const response = await getRedisKeysDirect(
      {
        cursor: 'c-1',
        limit: 1000
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(multiMock).not.toHaveBeenCalled();
    expect(parseJson(response.json)).toEqual({
      keys: [],
      cursor: '0',
      hasMore: false
    });
  });

  it('reads redis values by key type', async () => {
    getRedisClientMock.mockResolvedValue({
      type: vi.fn().mockResolvedValue('string'),
      ttl: vi.fn().mockResolvedValue(5),
      get: vi.fn().mockResolvedValue('hello'),
      sMembers: vi.fn(),
      hGetAll: vi.fn()
    });

    const stringResponse = await getRedisValueDirect(
      {
        key: 'str-key'
      },
      {
        requestHeader: new Headers()
      }
    );
    expect(parseJson(stringResponse.json)).toEqual({
      key: 'str-key',
      type: 'string',
      ttl: 5,
      value: 'hello'
    });

    getRedisClientMock.mockResolvedValueOnce({
      type: vi.fn().mockResolvedValue('set'),
      ttl: vi.fn().mockResolvedValue(10),
      get: vi.fn(),
      sMembers: vi.fn().mockResolvedValue(['a', 'b']),
      hGetAll: vi.fn()
    });

    const setResponse = await getRedisValueDirect(
      {
        key: 'set-key'
      },
      {
        requestHeader: new Headers()
      }
    );
    expect(parseJson(setResponse.json)).toEqual({
      key: 'set-key',
      type: 'set',
      ttl: 10,
      value: ['a', 'b']
    });

    getRedisClientMock.mockResolvedValueOnce({
      type: vi.fn().mockResolvedValue('hash'),
      ttl: vi.fn().mockResolvedValue(20),
      get: vi.fn(),
      sMembers: vi.fn(),
      hGetAll: vi.fn().mockResolvedValue({ field: 'value' })
    });

    const hashResponse = await getRedisValueDirect(
      {
        key: 'hash-key'
      },
      {
        requestHeader: new Headers()
      }
    );
    expect(parseJson(hashResponse.json)).toEqual({
      key: 'hash-key',
      type: 'hash',
      ttl: 20,
      value: {
        field: 'value'
      }
    });

    getRedisClientMock.mockResolvedValueOnce({
      type: vi.fn().mockResolvedValue('zset'),
      ttl: vi.fn().mockResolvedValue(-1),
      get: vi.fn(),
      sMembers: vi.fn(),
      hGetAll: vi.fn()
    });

    const unsupportedResponse = await getRedisValueDirect(
      {
        key: 'zset-key'
      },
      {
        requestHeader: new Headers()
      }
    );
    expect(parseJson(unsupportedResponse.json)).toEqual({
      key: 'zset-key',
      type: 'zset',
      ttl: -1,
      value: null
    });
  });

  it('returns not found when redis key does not exist', async () => {
    getRedisClientMock.mockResolvedValue({
      type: vi.fn().mockResolvedValue('none'),
      ttl: vi.fn(),
      get: vi.fn(),
      sMembers: vi.fn(),
      hGetAll: vi.fn()
    });

    await expect(
      getRedisValueDirect(
        {
          key: 'missing-key'
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.NotFound
    });
  });

  it('deletes keys and returns db size', async () => {
    getRedisClientMock.mockResolvedValueOnce({
      del: vi.fn().mockResolvedValue(1)
    });

    const deleteResponse = await deleteRedisKeyDirect(
      {
        key: 'user:1'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(deleteResponse.json)).toEqual({
      deleted: true
    });

    getRedisClientMock.mockResolvedValueOnce({
      dbSize: vi.fn().mockResolvedValue(123)
    });

    const sizeResponse = await getRedisDbSizeDirect(
      {},
      {
        requestHeader: new Headers()
      }
    );
    expect(parseJson(sizeResponse.json)).toEqual({
      count: 123
    });
  });

  it('maps unexpected redis failures to internal errors', async () => {
    getRedisClientMock.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(
      getRedisKeysDirect(
        {
          cursor: '0',
          limit: 10
        },
        {
          requestHeader: new Headers()
        }
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });
});
