import { describe, expect, it, vi } from 'vitest';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';
import { encodeUtf8ToBase64 } from './syncHttpTransportTestHelpers.js';

const TEST_ORGANIZATION_ID = 'org-1';
const RECONCILE_CURSOR_CHANGE_ID = '00000000-0000-0000-0000-000000000001';

function connectJsonEnvelope(payload: unknown): string {
  return JSON.stringify({ json: JSON.stringify(payload) });
}

describe('VfsHttpCrdtSyncTransport guardrails', () => {
  it('fails closed when push response shape is invalid', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(connectJsonEnvelope({ bad: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock,
      organizationId: TEST_ORGANIZATION_ID
    });

    await expect(
      transport.pushOperations({
        userId: 'user-1',
        clientId: 'desktop',
        operations: []
      })
    ).rejects.toThrowError(/invalid clientId/);
  });

  it('fails closed when reconcile response references another client', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          connectJsonEnvelope({
            clientId: encodeUtf8ToBase64('wrong-client'),
            cursor: encodeVfsSyncCursor({
              changedAt: '2026-02-14T20:00:00.000Z',
              changeId: RECONCILE_CURSOR_CHANGE_ID
            }),
            lastReconciledWriteIds: {}
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock,
      organizationId: TEST_ORGANIZATION_ID
    });

    await expect(
      transport.reconcileState({
        userId: 'user-1',
        clientId: 'desktop',
        cursor: {
          changedAt: '2026-02-14T20:00:00.000Z',
          changeId: RECONCILE_CURSOR_CHANGE_ID
        },
        lastReconciledWriteIds: {}
      })
    ).rejects.toThrowError(/mismatched clientId/);
  });

  it('fails closed when pull response cursor is malformed', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          connectJsonEnvelope({
            items: [],
            nextCursor: 'not-a-valid-base64-json-cursor',
            hasMore: false,
            lastReconciledWriteIds: {}
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock,
      organizationId: TEST_ORGANIZATION_ID
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
          connectJsonEnvelope({
            items: [],
            nextCursor: null,
            hasMore: false,
            // zero is invalid for reconcile write ids
            lastReconciledWriteIds: {
              desktop: '0'
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
    );

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock,
      organizationId: TEST_ORGANIZATION_ID
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
