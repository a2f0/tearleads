import type { Response } from 'supertest';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

const mockConnect = vi.fn();
const mockQuit = vi.fn();
const mockSubscribe = vi.fn();
const mockDuplicate = vi.fn();
const mockQuery = vi.fn();

type ParserCallback = (error: Error | null, body: unknown) => void;

interface DestroyableResponse extends Response {
  destroy(): void;
}

function isDestroyable(res: Response): res is DestroyableResponse {
  return 'destroy' in res && typeof res.destroy === 'function';
}

function createSseParser(onData: (data: string, res: Response) => void) {
  return (res: Response, callback: ParserCallback) => {
    let data = '';
    let doneCalled = false;
    const done = (error: Error | null) => {
      if (doneCalled) {
        return;
      }
      doneCalled = true;
      callback(error, data);
    };

    res.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      onData(data, res);
    });
    res.on('end', () => done(null));
    res.on('close', () => done(null));
  };
}

vi.mock('../../lib/redisPubSub.js', () => ({
  getRedisSubscriberClient: vi.fn(() =>
    Promise.resolve({
      duplicate: mockDuplicate
    })
  )
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: vi.fn(() =>
    Promise.resolve({
      query: mockQuery
    })
  ),
  getPool: vi.fn(() =>
    Promise.resolve({
      query: mockQuery
    })
  )
}));

describe('SSE VFS container channels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockConnect.mockResolvedValue(undefined);
    mockQuit.mockResolvedValue(undefined);
    mockSubscribe.mockResolvedValue(undefined);
    mockDuplicate.mockReturnValue({
      connect: mockConnect,
      quit: mockQuit,
      subscribe: mockSubscribe,
      unsubscribe: vi.fn().mockResolvedValue(undefined)
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('subscribes to authorized VFS container channels', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({ rows: [{ item_id: 'item-1' }] });

    const response = await request(app)
      .get('/v1/sse?channels=vfs:container:item-1:sync')
      .set('Authorization', authHeader)
      .buffer(true)
      .parse(
        createSseParser((data, res) => {
          if (data.includes('event: connected')) {
            if (isDestroyable(res)) {
              res.destroy();
            }
          }
        })
      );

    expect(response.body).toContain('"channels":["vfs:container:item-1:sync"]');
    expect(mockSubscribe).toHaveBeenCalledWith(
      'vfs:container:item-1:sync',
      expect.any(Function)
    );
  });

  it('filters unauthorized VFS container channels', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({ rows: [{ item_id: 'item-1' }] });

    const response = await request(app)
      .get(
        '/v1/sse?channels=vfs:container:item-1:sync,vfs:container:item-2:sync'
      )
      .set('Authorization', authHeader)
      .buffer(true)
      .parse(
        createSseParser((data, res) => {
          if (data.includes('event: connected')) {
            if (isDestroyable(res)) {
              res.destroy();
            }
          }
        })
      );

    expect(response.body).toContain('"channels":["vfs:container:item-1:sync"]');
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith(
      'vfs:container:item-1:sync',
      expect.any(Function)
    );
  });
});
