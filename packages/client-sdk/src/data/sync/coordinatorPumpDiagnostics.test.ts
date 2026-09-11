import { expect, mock, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createContainerContentsTestRuntime } from "../../stores/container-contents/runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "../../stores/container-contents/state";
import { createContainerContentsStoreSyncAgent } from "../../stores/container-contents/syncAgent";
import type {
  ContainerContentsStoreRuntime,
  ContainerContentsStoreSyncAgent,
} from "../../stores/container-contents/syncAgentTypes";
import type { ContainerContentsStoreState } from "../../stores/container-contents/types";
import { createReconciliationService } from "../../sync/reconciliation/service";
import {
  createReconciliationTestHost,
  silenceExpectedTransientDiscoveryError,
} from "../../sync/reconciliation/service.testFixtures";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import { CONTAINER_CONTENTS_SYNC_LANE_KEY } from "../../workflows/container-contents/syncLane";
import { registerDocumentSyncLane } from "../../workflows/documents/syncLane";
import type { DomainScope } from "../domainScope";
import { createDomainScope } from "../domainScope";
import { DatabaseUnavailableError } from "./databaseUnavailable";
import {
  disposeDomainSyncCoordinator,
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
  isDatabaseUnavailableError,
  type SyncLane,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";

const DOCUMENT_LANE_KEY = "documents:private-local-id";

async function settle(domainScope: DomainScope): Promise<void> {
  // A settled pump proves the run promise resolved and the lane released its
  // run token. A wedged lane keeps its token and never reports idle.
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      quietMs: 0,
      timeoutMs: 500,
    }),
  ).toBe(true);
}

async function runLaneOnce(
  domainScope: DomainScope,
  lane: SyncLane,
): Promise<void> {
  lane.requestSync();
  await settle(domainScope);
}

// Assert the lane's own console line still fired — a report must never replace
// it — and keep the expected line out of the suite's output.
function expectLaneConsoleError(prefix: string): () => void {
  const originalConsoleError = console.error;
  let actualCount = 0;

  console.error = (...args: unknown[]) => {
    if (args[0] === prefix) {
      actualCount += 1;
      return;
    }

    originalConsoleError(...args);
  };

  return () => {
    console.error = originalConsoleError;
    expect(actualCount).toBe(1);
  };
}

function readLaneSnapshot(domainScope: DomainScope, key: string) {
  const lane = getDomainSyncCoordinatorSnapshot(domainScope).lanes.find(
    (candidate) => candidate.key === key,
  );
  if (!lane) throw new Error(`Expected a registered ${key} lane`);
  return lane;
}

test("an unrecoverable lane reports once and still re-arms", async () => {
  const domainScope = createDomainScope();
  const reported: unknown[] = [];
  const failure = new Error("Loro import failed");
  const lane = getOrCreateDomainSyncCoordinator(domainScope).registerLane(
    DOCUMENT_LANE_KEY,
    {
      onUnexpectedError: () => undefined,
      reportUnexpectedError: (error) => reported.push(error),
      run: () => Promise.reject(failure),
      shouldIgnoreError: isDatabaseUnavailableError,
    },
  );
  try {
    await runLaneOnce(domainScope, lane);
    await runLaneOnce(domainScope, lane);

    expect(reported).toEqual([failure]);
    const snapshot = readLaneSnapshot(domainScope, DOCUMENT_LANE_KEY);
    // A second run can only start once the first cleared its run token.
    expect(snapshot.runCount).toBe(2);
    expect(snapshot.running).toBe(false);
    expect(snapshot.lastAction).toBe("failed");
  } finally {
    disposeDomainSyncCoordinator(domainScope);
  }
});

test("a lane reports again once its failure changes", async () => {
  const domainScope = createDomainScope();
  const reported: unknown[] = [];
  const failures = [
    new Error("Loro import failed"),
    new Error("Loro import failed"),
    new Error("Persistence rejected the batch"),
  ];
  let runIndex = 0;
  const lane = getOrCreateDomainSyncCoordinator(domainScope).registerLane(
    DOCUMENT_LANE_KEY,
    {
      onUnexpectedError: () => undefined,
      reportUnexpectedError: (error) => reported.push(error),
      run: () => Promise.reject(failures[runIndex++]),
      shouldIgnoreError: isDatabaseUnavailableError,
    },
  );
  try {
    for (const _failure of failures) {
      await runLaneOnce(domainScope, lane);
    }

    expect(reported).toEqual([failures[0], failures[2]]);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
  }
});

test("a database-unavailable failure is not reported", async () => {
  const domainScope = createDomainScope();
  const reported: unknown[] = [];
  const lane = getOrCreateDomainSyncCoordinator(domainScope).registerLane(
    DOCUMENT_LANE_KEY,
    {
      onUnexpectedError: () => undefined,
      reportUnexpectedError: (error) => reported.push(error),
      run: () =>
        Promise.reject(
          new DatabaseUnavailableError("Database client is unavailable."),
        ),
      shouldIgnoreError: isDatabaseUnavailableError,
    },
  );
  try {
    await runLaneOnce(domainScope, lane);

    expect(reported).toEqual([]);
    expect(readLaneSnapshot(domainScope, DOCUMENT_LANE_KEY).lastAction).toBe(
      "completed",
    );
  } finally {
    disposeDomainSyncCoordinator(domainScope);
  }
});

test.each(["throw", "reject"])(
  "a reporter that can %s does not wedge the lane",
  async (behavior) => {
    const domainScope = createDomainScope();
    const handled: unknown[] = [];
    const failure = new Error("Loro import failed");
    const lane = getOrCreateDomainSyncCoordinator(domainScope).registerLane(
      DOCUMENT_LANE_KEY,
      {
        onUnexpectedError: (error) => handled.push(error),
        reportUnexpectedError: () => {
          if (behavior === "throw")
            throw new Error("Diagnostic transport unavailable");
          return Promise.reject(new Error("Diagnostic transport unavailable"));
        },
        run: () => Promise.reject(failure),
        shouldIgnoreError: isDatabaseUnavailableError,
      },
    );
    try {
      await runLaneOnce(domainScope, lane);
      await runLaneOnce(domainScope, lane);

      // The durable handler still ran on both passes, and the lane re-armed.
      expect(handled).toEqual([failure, failure]);
      expect(readLaneSnapshot(domainScope, DOCUMENT_LANE_KEY).runCount).toBe(2);
    } finally {
      disposeDomainSyncCoordinator(domainScope);
    }
  },
);

test("the documents lane reports a fixed literal, never the local id", async () => {
  const domainScope = createDomainScope();
  const restoreConsoleError = expectLaneConsoleError(
    "Failed to sync document private-local-id:",
  );
  const failure = new Error("Loro import failed");
  const reports: unknown[] = [];
  const lane = registerDocumentSyncLane({
    domainScope,
    localId: "private-local-id",
    logError: (message, error) => reports.push([message, error]),
    run: () => Promise.reject(failure),
  });
  try {
    await runLaneOnce(domainScope, lane);

    // The local id belongs to the console line, not to a reportable message.
    expect(reports).toEqual([["Documents: sync lane failed", failure]]);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    restoreConsoleError();
  }
});

test("a rejecting host logger does not reject outside the documents lane", async () => {
  const domainScope = createDomainScope();
  const restoreConsoleError = expectLaneConsoleError(
    "Failed to sync document private-local-id:",
  );
  const lane = registerDocumentSyncLane({
    domainScope,
    localId: "private-local-id",
    logError: () =>
      Promise.reject(new Error("Diagnostic transport unavailable")),
    run: () => Promise.reject(new Error("Loro import failed")),
  });
  try {
    await runLaneOnce(domainScope, lane);
    // Let an escaped rejection reach the runtime's unhandled-rejection hook.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(readLaneSnapshot(domainScope, DOCUMENT_LANE_KEY).lastAction).toBe(
      "failed",
    );
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    restoreConsoleError();
  }
});

test("the reconciliation lane reports through a rejecting host logger", async () => {
  // The lane keeps its own console line; the silencer proves it still ran.
  const restoreConsoleError = silenceExpectedTransientDiscoveryError();
  const failure = new Error("transient discovery failure");
  const reports: unknown[] = [];
  const host = createReconciliationTestHost({
    discoverContainerDocuments: () => Promise.reject(failure),
    listAutomaticRootCatchupContainerIds: () => ["c-1"],
    listKnownContainerIds: () => ["c-1"],
    logError: (message, error) => {
      reports.push([message, error]);
      return Promise.reject(new Error("Diagnostic transport unavailable"));
    },
  });
  const service = createReconciliationService(host);
  try {
    service.start();
    service.enqueueContainer("c-1", "active");
    await settle(host.domainScope);
    // Let an escaped rejection reach the runtime's unhandled-rejection hook.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(reports).toEqual([["Reconciliation: sync lane failed", failure]]);
  } finally {
    service.stop();
    disposeDomainSyncCoordinator(host.domainScope);
    restoreConsoleError();
  }
});

function withLogError(
  runtime: ContainerContentsStoreRuntime,
  logError: (message: string | Error, cause?: unknown) => unknown,
): ContainerContentsStoreRuntime {
  return { ...runtime, util: { ...runtime.util, logError } };
}

function createFailingContainerContentsAgent(input: {
  domainScope: DomainScope;
  failure: unknown;
  registrationRuntimeLogError: (message: string | Error) => unknown;
}): {
  agent: ContainerContentsStoreSyncAgent;
  state: ContainerContentsStoreState;
} {
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    listDormantMetadataSweepRequests: async () => [],
    listPendingCreateIntents: async () => {
      throw input.failure;
    },
  };
  const state = createContainerContentsStoreState(
    withLogError(
      createContainerContentsTestRuntime({
        domainScope: input.domainScope,
        encapsulationKeyPair: generateKemSeedAndKeyPair(),
        execSql: mock(async () => []),
      }),
      input.registrationRuntimeLogError,
    ),
    persistence,
  );
  updateContainerContentsSnapshot(state);
  const agent = createContainerContentsStoreSyncAgent({
    host: {
      persistContainerState: () =>
        Promise.reject(new Error("the failing lane must not persist state")),
      updateSnapshot: () => updateContainerContentsSnapshot(state),
    },
    state,
  });
  return { agent, state };
}

test("the container-contents lane reports through a replaced runtime", async () => {
  const domainScope = createDomainScope();
  const restoreConsoleError = expectLaneConsoleError(
    "Failed to run sync lane container-contents:",
  );
  const failure = new Error("Container create intents unavailable");
  const staleReports: unknown[] = [];
  const liveReports: unknown[] = [];
  const { agent, state } = createFailingContainerContentsAgent({
    domainScope,
    failure,
    registrationRuntimeLogError: (message) => staleReports.push(message),
  });
  try {
    // updateContainerContentsStoreRuntime replaces state.runtime in place. A
    // reporter that captured the runtime at registration would keep writing to
    // the previous identity's host.
    state.runtime = withLogError(state.runtime, (message, cause) =>
      liveReports.push([message, cause]),
    );

    agent.scheduleSync();
    await settle(domainScope);

    expect(
      readLaneSnapshot(domainScope, CONTAINER_CONTENTS_SYNC_LANE_KEY)
        .lastAction,
    ).toBe("failed");
    expect(staleReports).toEqual([]);
    expect(liveReports).toEqual([
      ["Container contents: sync lane failed", failure],
    ]);
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    restoreConsoleError();
  }
});

// A host logger may be async even though it is declared `=> void`. Every hop
// between the lane and the host must hand its promise back, or the rejection
// escapes the reporter's wrapper as an unhandled rejection — which Bun fails
// the run on, and a browser turns into a global error event.
test("a rejecting host logger does not reject outside the contents lane", async () => {
  const domainScope = createDomainScope();
  const restoreConsoleError = expectLaneConsoleError(
    "Failed to run sync lane container-contents:",
  );
  const { agent } = createFailingContainerContentsAgent({
    domainScope,
    failure: new Error("Container create intents unavailable"),
    registrationRuntimeLogError: () =>
      Promise.reject(new Error("Diagnostic transport unavailable")),
  });
  try {
    agent.scheduleSync();
    await settle(domainScope);
    // Let an escaped rejection reach the runtime's unhandled-rejection hook.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(
      readLaneSnapshot(domainScope, CONTAINER_CONTENTS_SYNC_LANE_KEY)
        .lastAction,
    ).toBe("failed");
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    restoreConsoleError();
  }
});
