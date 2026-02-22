import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient,
  waitFor
} from './sync-client-test-support.js';

interface RaceHydrateConvergenceResult {
  hydrateError: string | null;
  guardrailViolations: Array<{
    code: string;
    stage: string;
    message: string;
  }>;
  desktopStateBeforeHydrate: ReturnType<VfsBackgroundSyncClient['exportState']>;
  mobileSnapshotBeforeDesktopResume: ReturnType<
    VfsBackgroundSyncClient['snapshot']
  >;
  desktopSnapshot: ReturnType<VfsBackgroundSyncClient['snapshot']>;
  mobileSnapshot: ReturnType<VfsBackgroundSyncClient['snapshot']>;
  serverSnapshot: ReturnType<InMemoryVfsCrdtSyncServer['snapshot']>;
}

interface RacePaginationForwardResult {
  hydrateError: string | null;
  guardrailViolations: Array<{
    code: string;
    stage: string;
    message: string;
  }>;
  baselineCursor: { changedAt: string; changeId: string };
  firstPageAfterBaseline: ReturnType<
    VfsBackgroundSyncClient['listChangedContainers']
  >;
  secondPageAfterBaseline: ReturnType<
    VfsBackgroundSyncClient['listChangedContainers']
  >;
  firstCursor: { changedAt: string; changeId: string };
}

interface RacePaginationRestartResult {
  firstPageBefore: ReturnType<VfsBackgroundSyncClient['listChangedContainers']>;
  secondPageBefore: ReturnType<
    VfsBackgroundSyncClient['listChangedContainers']
  >;
  thirdPageBefore: ReturnType<VfsBackgroundSyncClient['listChangedContainers']>;
  firstPageAfter: ReturnType<VfsBackgroundSyncClient['listChangedContainers']>;
  secondPageAfter: ReturnType<VfsBackgroundSyncClient['listChangedContainers']>;
  thirdPageAfter: ReturnType<VfsBackgroundSyncClient['listChangedContainers']>;
}

function createFlushGatedDesktopTransport(input: {
  server: InMemoryVfsCrdtSyncServer;
  onPushStarted: () => void;
  gate: Promise<void>;
}): VfsCrdtSyncTransport {
  return {
    pushOperations: async (pushInput) => {
      input.onPushStarted();
      await input.gate;
      return input.server.pushOperations({
        operations: pushInput.operations
      });
    },
    pullOperations: async (pullInput) =>
      input.server.pullOperations({
        cursor: pullInput.cursor,
        limit: pullInput.limit
      })
  };
}

export async function runHydrateRejectionDuringFlushConvergenceScenario(): Promise<RaceHydrateConvergenceResult> {
  const guardrailViolations: Array<{
    code: string;
    stage: string;
    message: string;
  }> = [];

  const server = new InMemoryVfsCrdtSyncServer();
  let pushStarted = false;
  let releaseDesktopPush: (() => void) | null = null;
  const desktopPushGate = new Promise<void>((resolve) => {
    releaseDesktopPush = resolve;
  });

  const desktopTransport = createFlushGatedDesktopTransport({
    server,
    onPushStarted: () => {
      pushStarted = true;
    },
    gate: desktopPushGate
  });
  const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
    pushDelayMs: 2,
    pullDelayMs: 2
  });

  const desktop = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    desktopTransport,
    {
      onGuardrailViolation: (violation) => {
        guardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    }
  );
  const mobile = new VfsBackgroundSyncClient(
    'user-1',
    'mobile',
    mobileTransport
  );

  desktop.queueLocalOperation({
    opType: 'acl_add',
    itemId: 'item-desktop',
    principalType: 'group',
    principalId: 'group-1',
    accessLevel: 'read',
    occurredAt: '2026-02-14T14:22:02.000Z'
  });
  const desktopFlushPromise = desktop.flush();
  await waitFor(() => pushStarted, 1000);

  mobile.queueLocalOperation({
    opType: 'link_add',
    itemId: 'item-mobile',
    parentId: 'root',
    childId: 'item-mobile',
    occurredAt: '2026-02-14T14:22:01.000Z'
  });
  await mobile.flush();
  await mobile.sync();

  const mobileSnapshotBeforeDesktopResume = mobile.snapshot();
  const desktopStateBeforeHydrate = desktop.exportState();
  const desktopPersisted = desktop.exportState();

  let hydrateError: string | null = null;
  try {
    desktop.hydrateState(desktopPersisted);
  } catch (error) {
    hydrateError = error instanceof Error ? error.message : String(error);
  }

  if (!releaseDesktopPush) {
    throw new Error('missing desktop push release hook');
  }
  releaseDesktopPush();
  await desktopFlushPromise;

  for (let index = 0; index < 3; index++) {
    await Promise.all([desktop.sync(), mobile.sync()]);
  }

  return {
    hydrateError,
    guardrailViolations,
    desktopStateBeforeHydrate,
    mobileSnapshotBeforeDesktopResume,
    desktopSnapshot: desktop.snapshot(),
    mobileSnapshot: mobile.snapshot(),
    serverSnapshot: server.snapshot()
  };
}

export async function runForwardOnlyPaginationAfterHydrateRaceScenario(): Promise<RacePaginationForwardResult> {
  const guardrailViolations: Array<{
    code: string;
    stage: string;
    message: string;
  }> = [];

  const server = new InMemoryVfsCrdtSyncServer();
  let pushStarted = false;
  let releaseDesktopPush: (() => void) | null = null;
  const desktopPushGate = new Promise<void>((resolve) => {
    releaseDesktopPush = resolve;
  });

  const desktopTransport = createFlushGatedDesktopTransport({
    server,
    onPushStarted: () => {
      pushStarted = true;
    },
    gate: desktopPushGate
  });
  const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
    pushDelayMs: 2,
    pullDelayMs: 2
  });

  const desktop = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    desktopTransport,
    {
      onGuardrailViolation: (violation) => {
        guardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    }
  );
  const mobile = new VfsBackgroundSyncClient(
    'user-1',
    'mobile',
    mobileTransport
  );

  mobile.queueLocalOperation({
    opType: 'acl_add',
    itemId: 'item-seed',
    principalType: 'group',
    principalId: 'group-1',
    accessLevel: 'read',
    occurredAt: '2026-02-14T14:24:00.000Z'
  });
  await mobile.flush();
  await desktop.sync();

  const baselinePage = desktop.listChangedContainers(null, 1);
  const baselineCursor = baselinePage.nextCursor;
  if (!baselineCursor) {
    throw new Error('expected baseline container cursor');
  }

  desktop.queueLocalOperation({
    opType: 'acl_add',
    itemId: 'item-desktop',
    principalType: 'organization',
    principalId: 'org-1',
    accessLevel: 'write',
    occurredAt: '2026-02-14T14:24:02.000Z'
  });
  const desktopFlushPromise = desktop.flush();
  await waitFor(() => pushStarted, 1000);

  mobile.queueLocalOperation({
    opType: 'link_add',
    itemId: 'item-mobile',
    parentId: 'root',
    childId: 'item-mobile',
    occurredAt: '2026-02-14T14:24:01.000Z'
  });
  await mobile.flush();
  await mobile.sync();

  let hydrateError: string | null = null;
  try {
    desktop.hydrateState(desktop.exportState());
  } catch (error) {
    hydrateError = error instanceof Error ? error.message : String(error);
  }

  if (!releaseDesktopPush) {
    throw new Error('missing desktop push release hook');
  }
  releaseDesktopPush();
  await desktopFlushPromise;

  for (let index = 0; index < 3; index++) {
    await Promise.all([desktop.sync(), mobile.sync()]);
  }

  const firstPageAfterBaseline = desktop.listChangedContainers(
    baselineCursor,
    1
  );
  const firstCursor = firstPageAfterBaseline.nextCursor;
  if (!firstCursor) {
    throw new Error('expected pagination cursor after first forward page');
  }

  return {
    hydrateError,
    guardrailViolations,
    baselineCursor,
    firstPageAfterBaseline,
    secondPageAfterBaseline: desktop.listChangedContainers(firstCursor, 10),
    firstCursor
  };
}

export async function runContainerClockPaginationRestartScenario(): Promise<RacePaginationRestartResult> {
  const server = new InMemoryVfsCrdtSyncServer();
  const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
    pushDelayMs: 4,
    pullDelayMs: 3
  });
  const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
    pushDelayMs: 2,
    pullDelayMs: 5
  });

  const desktop = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    desktopTransport,
    {
      pullLimit: 2
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

  mobile.queueLocalOperation({
    opType: 'acl_add',
    itemId: 'item-rt-1',
    principalType: 'group',
    principalId: 'group-1',
    accessLevel: 'read',
    occurredAt: '2026-02-14T14:25:00.000Z'
  });
  mobile.queueLocalOperation({
    opType: 'link_add',
    itemId: 'item-rt-2',
    parentId: 'root',
    childId: 'item-rt-2',
    occurredAt: '2026-02-14T14:25:01.000Z'
  });
  await mobile.flush();
  await desktop.sync();

  const firstPageBefore = desktop.listChangedContainers(null, 1);
  const secondPageBefore = desktop.listChangedContainers(
    firstPageBefore.nextCursor,
    1
  );
  const thirdPageBefore = desktop.listChangedContainers(
    secondPageBefore.nextCursor,
    10
  );

  const persistedState = desktop.exportState();
  const resumedDesktop = new VfsBackgroundSyncClient(
    'user-1',
    'desktop',
    desktopTransport,
    {
      pullLimit: 2
    }
  );
  resumedDesktop.hydrateState(persistedState);

  const firstPageAfter = resumedDesktop.listChangedContainers(null, 1);
  const secondPageAfter = resumedDesktop.listChangedContainers(
    firstPageAfter.nextCursor,
    1
  );

  return {
    firstPageBefore,
    secondPageBefore,
    thirdPageBefore,
    firstPageAfter,
    secondPageAfter,
    thirdPageAfter: resumedDesktop.listChangedContainers(
      secondPageAfter.nextCursor,
      10
    )
  };
}
