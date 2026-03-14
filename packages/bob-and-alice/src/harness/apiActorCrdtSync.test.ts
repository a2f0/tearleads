import { VFS_V2_CONNECT_BASE_PATH } from '@tearleads/shared';
import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { describe, expect, it, vi } from 'vitest';
import { createApiActorCrdtTransport } from './apiActorCrdtSync.js';

function connectJsonEnvelope(payload: unknown): string {
  return JSON.stringify({ json: JSON.stringify(payload) });
}

describe('createApiActorCrdtTransport', () => {
  it('routes GetCrdtSync through ApiActor.fetch and decodes cursors', async () => {
    const requestCursor = {
      changedAt: '2026-03-08T00:00:00.000Z',
      changeId: '00000000-0000-0000-0000-000000000001'
    };
    const nextCursor = {
      changedAt: '2026-03-08T00:00:01.000Z',
      changeId: '00000000-0000-0000-0000-000000000002'
    };
    const actor = {
      alias: 'alice',
      user: {
        userId: 'user-1',
        email: 'alice@test.local',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        sessionId: 'session-1',
        organizationId: 'org-1'
      },
      fetch: vi.fn(async (path: string, init?: RequestInit) => {
        expect(path).toBe(`${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync`);
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(
          JSON.stringify({
            limit: 25,
            cursor: encodeVfsSyncCursor(requestCursor)
          })
        );

        return new Response(
          connectJsonEnvelope({
            items: [],
            hasMore: false,
            nextCursor: encodeVfsSyncCursor(nextCursor),
            lastReconciledWriteIds: {
              desktop: 3
            }
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }),
      fetchJson: vi.fn()
    };

    const transport = createApiActorCrdtTransport({
      actor
    });

    await expect(
      transport.pullOperations({
        userId: actor.user.userId,
        clientId: 'desktop',
        cursor: requestCursor,
        limit: 25
      })
    ).resolves.toEqual({
      items: [],
      hasMore: false,
      bloomFilter: null,
      nextCursor,
      lastReconciledWriteIds: {
        desktop: 3
      }
    });
  });
});
