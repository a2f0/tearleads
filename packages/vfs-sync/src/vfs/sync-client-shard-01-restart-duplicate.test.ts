import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('fails closed on duplicate pull replay after hydrate restart pagination', async () => {
    const seedServer = new InMemoryVfsCrdtSyncServer();
    await seedServer.pushOperations({
      operations: [
        {
          opId: 'remote-seed-restart-dup',
          opType: 'acl_add',
          itemId: 'item-seed-restart-dup',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:04:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(seedServer),
      {
        pullLimit: 1
      }
    );
    await sourceClient.sync();
    const persistedState = sourceClient.exportState();
    const persistedCursor = sourceClient.snapshot().cursor;
    if (!persistedCursor) {
      throw new Error(
        'expected persisted cursor before restart duplication run'
      );
    }

    let pullCount = 0;
    const pullCursorSignatures: string[] = [];
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async (input) => {
        pullCursorSignatures.push(
          input.cursor
            ? `${input.cursor.changedAt}|${input.cursor.changeId}`
            : 'null'
        );
        pullCount += 1;

        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-restart-dup',
                occurredAt: '2026-02-14T12:04:01.000Z',
                itemId: 'item-restart-first-page'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:04:01.000Z',
              changeId: 'desktop-restart-dup'
            },
            lastReconciledWriteIds: {
              desktop: 1
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-restart-dup',
              occurredAt: '2026-02-14T12:04:02.000Z',
              itemId: 'item-restart-second-page'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:04:02.000Z',
            changeId: 'desktop-restart-dup'
          },
          lastReconciledWriteIds: {
            desktop: 2
          }
        };
      }
    };
    const targetClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    targetClient.hydrateState(persistedState);

    await expect(targetClient.sync()).rejects.toThrow(
      /replayed opId desktop-restart-dup during pull pagination/
    );
    expect(pullCount).toBe(2);
    expect(pullCursorSignatures).toEqual([
      `${persistedCursor.changedAt}|${persistedCursor.changeId}`,
      '2026-02-14T12:04:01.000Z|desktop-restart-dup'
    ]);
    expect(guardrailViolations).toEqual([
      {
        code: 'pullDuplicateOpReplay',
        stage: 'pull',
        message:
          'pull response replayed an opId within one pull-until-settled cycle'
      }
    ]);
    expect(targetClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:04:01.000Z',
      changeId: 'desktop-restart-dup'
    });
  });
});
