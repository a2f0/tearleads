import type {
  ObservedPhasePullPage,
  ObservedPullPage
} from './sync-client-test-support.js';
import {
  createPhasePullRecordingTransportFactory,
  createPullRecordingTransport,
  filterObservedPullsByPhase,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  readReplaySnapshotCursorOrThrow,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

interface Shard09ReplicaHandoffResult {
  seedReplayCursor: { changedAt: string; changeId: string };
  cycleOnePulls: ObservedPullPage[];
  cycleTwoPulls: ObservedPullPage[];
  cycleOneTerminalCursor: { changedAt: string; changeId: string };
}

interface Shard09BoundaryReplayResult {
  seedReplayCursor: { changedAt: string; changeId: string };
  resumedPulls: ObservedPhasePullPage[];
  resumedPulledOpIds: string[];
  seedGuardrailViolations: Array<{
    code: string;
    stage: string;
    message: string;
  }>;
  resumedGuardrailViolations: Array<{
    code: string;
    stage: string;
    message: string;
  }>;
  resumedLastReconciledRemoteWriteId: number;
  resumedCursor: { changedAt: string; changeId: string };
}

export async function runReplicaHandoffMonotonicScenario(): Promise<Shard09ReplicaHandoffResult> {
  const server = new InMemoryVfsCrdtSyncServer();
  const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
    pushDelayMs: 3,
    pullDelayMs: 3
  });
  const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
    pushDelayMs: 2,
    pullDelayMs: 4
  });
  const tabletTransport = new InMemoryVfsCrdtSyncTransport(server, {
    pushDelayMs: 1,
    pullDelayMs: 5
  });

  const desktop = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    desktopTransport,
    {
      pullLimit: 1
    }
  );
  const mobile = new VfsBackgroundSyncClient(
    'user-1',
    'mobile',
    mobileTransport,
    {
      pullLimit: 1
    }
  );
  const tablet = new VfsBackgroundSyncClient(
    'user-1',
    'tablet',
    tabletTransport,
    {
      pullLimit: 1
    }
  );

  mobile.queueLocalOperation({
    opType: 'acl_add',
    itemId: 'item-handoff-a',
    principalType: 'group',
    principalId: 'group-1',
    accessLevel: 'read',
    occurredAt: '2026-02-14T14:34:00.000Z'
  });
  await mobile.flush();
  await desktop.sync();

  const persistedDesktopState = desktop.exportState();
  const seedReplayCursor = readReplaySnapshotCursorOrThrow({
    state: persistedDesktopState,
    errorMessage: 'expected replay seed cursor before handoff cycles'
  });

  const observedPulls: ObservedPullPage[] = [];
  const observingDesktopTransport = createPullRecordingTransport({
    baseTransport: desktopTransport,
    observedPulls
  });

  const resumedDesktop = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    observingDesktopTransport,
    { pullLimit: 1 }
  );
  resumedDesktop.hydrateState(persistedDesktopState);
  await resumedDesktop.sync();

  const cycleOneStart = observedPulls.length;

  mobile.queueLocalOperation({
    opType: 'link_add',
    itemId: 'item-handoff-a',
    parentId: 'root',
    childId: 'item-handoff-a',
    occurredAt: '2026-02-14T14:34:01.000Z'
  });
  mobile.queueLocalOperation({
    opType: 'acl_add',
    itemId: 'item-handoff-b',
    principalType: 'organization',
    principalId: 'org-1',
    accessLevel: 'write',
    occurredAt: '2026-02-14T14:34:02.000Z'
  });
  await mobile.flush();
  await resumedDesktop.sync();

  const cycleOnePulls = observedPulls.slice(cycleOneStart);
  const cycleOneTerminalCursor =
    cycleOnePulls[cycleOnePulls.length - 1]?.nextCursor;
  if (!cycleOneTerminalCursor) {
    throw new Error('expected cycle one handoff terminal cursor');
  }

  const cycleTwoStart = observedPulls.length;

  tablet.queueLocalOperation({
    opType: 'link_add',
    itemId: 'item-handoff-c',
    parentId: 'root',
    childId: 'item-handoff-c',
    occurredAt: '2026-02-14T14:34:03.000Z'
  });
  tablet.queueLocalOperation({
    opType: 'acl_add',
    itemId: 'item-handoff-c',
    principalType: 'group',
    principalId: 'group-2',
    accessLevel: 'admin',
    occurredAt: '2026-02-14T14:34:04.000Z'
  });
  await tablet.flush();
  await resumedDesktop.sync();

  return {
    seedReplayCursor,
    cycleOnePulls,
    cycleTwoPulls: observedPulls.slice(cycleTwoStart),
    cycleOneTerminalCursor
  };
}

export async function runBoundaryReplayAvoidanceScenario(): Promise<Shard09BoundaryReplayResult> {
  const server = new InMemoryVfsCrdtSyncServer();
  await server.pushOperations({
    operations: [
      {
        opId: 'remote-1',
        opType: 'acl_add',
        itemId: 'item-boundary-a',
        replicaId: 'remote',
        writeId: 1,
        occurredAt: '2026-02-14T14:35:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      },
      {
        opId: 'remote-2',
        opType: 'acl_add',
        itemId: 'item-boundary-b',
        replicaId: 'remote',
        writeId: 2,
        occurredAt: '2026-02-14T14:35:01.000Z',
        principalType: 'group',
        principalId: 'group-2',
        accessLevel: 'write'
      }
    ]
  });

  const observedPulls: ObservedPhasePullPage[] = [];
  const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
  const makeObservedTransport = createPhasePullRecordingTransportFactory({
    baseTransport,
    observedPulls,
    includeLastReconciledWriteIds: true
  });

  const seedGuardrailViolations: Array<{
    code: string;
    stage: string;
    message: string;
  }> = [];
  const seedClient = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    makeObservedTransport('seed'),
    {
      pullLimit: 1,
      onGuardrailViolation: (violation) => {
        seedGuardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    }
  );
  await seedClient.sync();

  const persistedSeedState = seedClient.exportState();
  const seedReplayCursor = readReplaySnapshotCursorOrThrow({
    state: persistedSeedState,
    errorMessage: 'expected replay seed cursor before restart'
  });

  await server.pushOperations({
    operations: [
      {
        opId: 'remote-3',
        opType: 'link_add',
        itemId: 'item-boundary-c',
        replicaId: 'remote',
        writeId: 3,
        occurredAt: '2026-02-14T14:35:02.000Z',
        parentId: 'root',
        childId: 'item-boundary-c'
      },
      {
        opId: 'remote-4',
        opType: 'acl_add',
        itemId: 'item-boundary-c',
        replicaId: 'remote',
        writeId: 4,
        occurredAt: '2026-02-14T14:35:03.000Z',
        principalType: 'organization',
        principalId: 'org-1',
        accessLevel: 'admin'
      }
    ]
  });

  const resumedGuardrailViolations: Array<{
    code: string;
    stage: string;
    message: string;
  }> = [];
  const resumedClient = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    makeObservedTransport('resumed'),
    {
      pullLimit: 1,
      onGuardrailViolation: (violation) => {
        resumedGuardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    }
  );
  resumedClient.hydrateState(persistedSeedState);
  await resumedClient.sync();

  const resumedPulls = filterObservedPullsByPhase({
    observedPulls,
    phase: 'resumed'
  });

  const resumedCursor = resumedClient.snapshot().cursor;
  if (!resumedCursor) {
    throw new Error('expected resumed cursor');
  }

  return {
    seedReplayCursor,
    resumedPulls,
    resumedPulledOpIds: resumedPulls.flatMap((pull) =>
      pull.items.map((item) => item.opId)
    ),
    seedGuardrailViolations,
    resumedGuardrailViolations,
    resumedLastReconciledRemoteWriteId:
      resumedClient.snapshot().lastReconciledWriteIds.remote ?? 0,
    resumedCursor
  };
}
