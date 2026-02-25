import { describe, expect, it } from 'vitest';
import {
  createGuardrailViolationCollector,
  toStageCodeSignatures
} from '../client/sync-client-test-support-observers.js';
import {
  InMemoryVfsCrdtSyncServer,
  VfsBackgroundSyncClient
} from '../index.js';
import { createServerBackedFetch } from './sync-http-transport.integration-harness.js';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

describe('VfsHttpCrdtSyncTransport rematerialization integration', () => {
  it('recovers from compaction-window stale cursor via rematerialization callback', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-canonical',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-03-10T00:00:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const guardrailCollector = createGuardrailViolationCollector();
    let staleWindowFaultsRemaining = 1;
    let rematerializationCalls = 0;
    const fetchImpl = createServerBackedFetch(server, {
      delays: {},
      interceptPullResponse: ({ cursor }) => {
        if (!cursor || staleWindowFaultsRemaining === 0) {
          return null;
        }
        staleWindowFaultsRemaining -= 1;
        return new Response(
          JSON.stringify({
            error:
              'CRDT cursor is older than retained history; re-materialization required',
            code: 'crdt_rematerialization_required',
            requestedCursor: `sync:${cursor.changedAt}:${cursor.changeId}`,
            oldestAvailableCursor:
              'sync:2026-03-10T00%3A00%3A00.000Z:remote-1'
          }),
          { status: 409 }
        );
      }
    });

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl
      }),
      {
        onGuardrailViolation: guardrailCollector.onGuardrailViolation,
        onRematerializationRequired: async () => {
          rematerializationCalls += 1;
          const canonical = server.snapshot();
          const lastFeedItem = canonical.feed[canonical.feed.length - 1] ?? null;
          const canonicalCursor = lastFeedItem
            ? {
                changedAt: lastFeedItem.occurredAt,
                changeId: lastFeedItem.opId
              }
            : null;
          return {
            replaySnapshot: {
              acl: canonical.acl,
              links: canonical.links,
              cursor: canonicalCursor
            },
            reconcileState: canonicalCursor
              ? {
                  cursor: canonicalCursor,
                  lastReconciledWriteIds: canonical.lastReconciledWriteIds
                }
              : null,
            containerClocks: []
          };
        }
      }
    );

    client.hydrateState({
      replaySnapshot: {
        acl: [
          {
            itemId: 'item-stale',
            principalType: 'group',
            principalId: 'group-stale',
            accessLevel: 'write'
          }
        ],
        links: [],
        cursor: {
          changedAt: '2026-02-01T00:00:00.000Z',
          changeId: 'stale-1'
        }
      },
      reconcileState: {
        cursor: {
          changedAt: '2026-02-01T00:00:00.000Z',
          changeId: 'stale-1'
        },
        lastReconciledWriteIds: {
          desktop: 3
        }
      },
      containerClocks: [],
      pendingOperations: [],
      nextLocalWriteId: 4
    });

    await client.sync();

    expect(rematerializationCalls).toBe(1);
    expect(toStageCodeSignatures(guardrailCollector.violations)).toContain(
      'pull:pullRematerializationRequired'
    );
    const snapshot = client.snapshot();
    const canonical = server.snapshot();
    const canonicalTail = canonical.feed[canonical.feed.length - 1] ?? null;
    expect(snapshot.acl).toEqual(canonical.acl);
    expect(snapshot.links).toEqual(canonical.links);
    expect(snapshot.cursor).toEqual(
      canonicalTail
        ? {
            changedAt: canonicalTail.occurredAt,
            changeId: canonicalTail.opId
          }
        : null
    );
    expect(snapshot.lastReconciledWriteIds).toEqual(
      canonical.lastReconciledWriteIds
    );
  });

  it('fails closed after bounded retries during repeated rematerialization faults', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const guardrailCollector = createGuardrailViolationCollector();
    let rematerializationCalls = 0;
    const fetchImpl = createServerBackedFetch(server, {
      delays: {},
      interceptPullResponse: ({ cursor }) => {
        const requestedCursor = cursor
          ? `sync:${cursor.changedAt}:${cursor.changeId}`
          : null;
        return new Response(
          JSON.stringify({
            error:
              'CRDT cursor is older than retained history; re-materialization required',
            code: 'crdt_rematerialization_required',
            requestedCursor,
            oldestAvailableCursor:
              'sync:2026-03-10T00%3A00%3A00.000Z:remote-oldest'
          }),
          { status: 409 }
        );
      }
    });

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new VfsHttpCrdtSyncTransport({
        baseUrl: 'https://sync.local',
        fetchImpl
      }),
      {
        maxRematerializationAttempts: 1,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation,
        onRematerializationRequired: async () => {
          rematerializationCalls += 1;
          return null;
        }
      }
    );

    await expect(client.sync()).rejects.toThrow(
      /re-materialization required/
    );

    expect(rematerializationCalls).toBe(1);
    expect(
      toStageCodeSignatures(guardrailCollector.violations).filter(
        (signature) => signature === 'pull:pullRematerializationRequired'
      )
    ).toHaveLength(2);
  });
});
