import { describe, expect, it, vi } from 'vitest';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import {
  encodeVfsCrdtReconcileResponseProtobuf,
  encodeVfsCrdtSyncResponseProtobuf
} from '../protocol/syncProtobuf.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

describe('VfsHttpCrdtSyncTransport guardrails', () => {
  it('fails closed when push response shape is invalid', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([8, 1]), {
          status: 200,
          headers: { 'Content-Type': 'application/x-protobuf' }
        })
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
    ).rejects.toThrowError(/index out of range|invalid push response/);
  });

  it('fails closed when reconcile response references another client', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          encodeVfsCrdtReconcileResponseProtobuf({
            clientId: 'wrong-client',
            cursor: encodeVfsSyncCursor({
              changedAt: '2026-02-14T20:00:00.000Z',
              changeId: 'op-1'
            }),
            lastReconciledWriteIds: {}
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/x-protobuf' }
          }
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
          encodeVfsCrdtSyncResponseProtobuf({
            items: [],
            nextCursor: 'not-a-valid-base64-json-cursor',
            hasMore: false,
            lastReconciledWriteIds: {}
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/x-protobuf' }
          }
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
          encodeVfsCrdtSyncResponseProtobuf({
            items: [],
            nextCursor: null,
            hasMore: false,
            // zero is invalid for reconcile write ids
            lastReconciledWriteIds: {
              desktop: 0
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/x-protobuf' }
          }
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
