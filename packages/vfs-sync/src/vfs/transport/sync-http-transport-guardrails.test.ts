import { describe, expect, it, vi } from 'vitest';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

describe('VfsHttpCrdtSyncTransport guardrails', () => {
  it('fails closed when push response shape is invalid', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            // Missing 'r' key or invalid status
            x: [{ opId: 'op-1', status: 'junk' }]
          }),
          { status: 200 }
        )
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock
    });

    await expect(
      transport.pushOperations({
        userId: 'user-1',
        clientId: 'desktop',
        operations: []
      })
    ).rejects.toThrowError(/invalid push response results/);
  });

  it('fails closed when reconcile response references another client', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            c: 'wrong-client',
            cur: encodeVfsSyncCursor({
              changedAt: '2026-02-14T20:00:00.000Z',
              changeId: 'op-1'
            })
          }),
          { status: 200 }
        )
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock
    });

    await expect(
      transport.reconcileState({
        userId: 'user-1',
        clientId: 'desktop',
        cursor: {
          changedAt: '2026-02-14T20:00:00.000Z',
          changeId: 'op-1'
        },
        lastReconciledWriteIds: {}
      })
    ).rejects.toThrowError(/mismatched clientId/);
  });

  it('fails closed when pull response cursor is malformed', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            i: [],
            n: 'not-a-valid-base64-json-cursor',
            m: false
          }),
          { status: 200 }
        )
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock
    });

    await expect(
      transport.pullOperations({
        userId: 'user-1',
        clientId: 'desktop',
        cursor: null,
        limit: 10
      })
    ).rejects.toThrowError(/invalid nextCursor/);
  });

  it('fails closed when pull response has invalid replica write ids', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            i: [],
            n: null,
            m: false,
            w: {
              desktop: 'not-a-number'
            }
          }),
          { status: 200 }
        )
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock
    });

    await expect(
      transport.pullOperations({
        userId: 'user-1',
        clientId: 'desktop',
        cursor: null,
        limit: 10
      })
    ).rejects.toThrowError(/invalid writeId/);
  });
});
