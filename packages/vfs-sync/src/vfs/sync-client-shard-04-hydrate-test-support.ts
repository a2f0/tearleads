import type {
  VfsCrdtSyncState,
  VfsSyncCursor,
  VfsSyncGuardrailViolation
} from './sync-client.js';
import {
  compareVfsSyncCursorOrder,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

export interface HydrateGuardrailRecord {
  code: string;
  stage: string;
  message: string;
}

export function createHydrateGuardrailHarness(input?: {
  transport?: InMemoryVfsCrdtSyncTransport;
}) {
  const guardrailViolations: HydrateGuardrailRecord[] = [];
  const client = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    input?.transport ??
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
    {
      onGuardrailViolation: (violation: VfsSyncGuardrailViolation) => {
        guardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    }
  );

  return {
    client,
    guardrailViolations
  };
}

export async function createEqualBoundaryHydrateState(): Promise<{
  server: InMemoryVfsCrdtSyncServer;
  persisted: VfsCrdtSyncState;
  replayCursor: VfsSyncCursor;
}> {
  const server = new InMemoryVfsCrdtSyncServer();
  await server.pushOperations({
    operations: [
      {
        opId: 'remote-1',
        opType: 'acl_add',
        itemId: 'item-hydrate-equal',
        replicaId: 'remote',
        writeId: 1,
        occurredAt: '2026-02-14T14:12:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      }
    ]
  });

  const sourceClient = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    new InMemoryVfsCrdtSyncTransport(server)
  );
  await sourceClient.sync();

  const persisted = sourceClient.exportState();
  const replayCursor = persisted.replaySnapshot.cursor;
  if (!replayCursor) {
    throw new Error('expected replay cursor for equal-boundary hydrate test');
  }

  const boundaryClock = persisted.containerClocks.find(
    (entry) => entry.containerId === 'item-hydrate-equal'
  );
  if (!boundaryClock) {
    throw new Error('expected container clock for equal-boundary hydrate test');
  }

  if (
    compareVfsSyncCursorOrder(
      {
        changedAt: boundaryClock.changedAt,
        changeId: boundaryClock.changeId
      },
      replayCursor
    ) !== 0
  ) {
    throw new Error('expected equal cursor order for boundary hydrate test');
  }

  persisted.reconcileState = {
    cursor: {
      changedAt: replayCursor.changedAt,
      changeId: replayCursor.changeId
    },
    lastReconciledWriteIds: {
      desktop: 1
    }
  };

  return {
    server,
    persisted,
    replayCursor
  };
}
