import { describe, expect, it, vi } from 'vitest';
import {
  createGuardrailViolationCollector,
  toStageCodeSignatures
} from '../client/sync-client-test-support-guardrails.js';
import {
  InMemoryVfsCrdtSyncServer,
  VfsBackgroundSyncClient,
  VfsHttpCrdtSyncTransport
} from '../index.js';
import { encodeVfsSyncCursor } from '../protocol/sync-cursor.js';
import { createServerBackedFetch } from './sync-http-transport.integration-harness.js';

describe('VfsHttpCrdtSyncTransport rematerialization integration', () => {
  it('recovers from compaction-window stale cursor via rematerialization callback', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const guardrailCollector = createGuardrailViolationCollector();

    let rematerializationCalls = 0;
    const onRematerializationRequired = vi.fn(async () => {
      rematerializationCalls++;
    });

    const requestedCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-10T00:00:00.000Z',
      changeId: 'op-old'
    });
    const oldestAvailableCursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T00:00:00.000Z',
      changeId: 'op-compaction-frontier'
    });

    let interceptCount = 0;
    const fetchImpl = createServerBackedFetch(server, {
      delays: {},
      interceptPullResponse: () => {
        interceptCount++;
        // Fail the first pull with 409
        if (interceptCount === 1) {
          return new Response(
            JSON.stringify({
              error: 'stale cursor',
              code: 'crdt_rematerialization_required',
              requestedCursor,
              oldestAvailableCursor
            }),
            { status: 409 }
          );
        }
        return null;
      }
    });

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'http://api.local',
      fetchImpl
    });

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      transport,
      {
        onRematerializationRequired,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );

    await client.sync();

    expect(rematerializationCalls).toBe(1);
    expect(toStageCodeSignatures(guardrailCollector.violations)).toContain(
      'pull:pullRematerializationRequired'
    );
  });

  it('fails closed after bounded retries during repeated rematerialization faults', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const onRematerializationRequired = vi.fn(async () => {});

    const fetchImpl = createServerBackedFetch(server, {
      delays: {},
      interceptPullResponse: () => {
        // Always fail with 409
        return new Response(
          JSON.stringify({
            error: 'persistent stale cursor',
            code: 'crdt_rematerialization_required',
            requestedCursor: '...',
            oldestAvailableCursor: '...'
          }),
          { status: 409 }
        );
      }
    });

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'http://api.local',
      fetchImpl
    });

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      transport,
      { onRematerializationRequired }
    );

    await expect(client.sync()).rejects.toThrow(/persistent stale cursor/);

    expect(onRematerializationRequired).toHaveBeenCalled();
  });
});
