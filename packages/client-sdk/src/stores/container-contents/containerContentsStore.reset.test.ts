import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsStoreRuntime,
} from "./state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgent";

function createRuntime(input: {
  dbStatus: "idle" | "ready";
}): ReturnType<typeof createContainerContentsTestRuntime> {
  return createContainerContentsTestRuntime({
    dbStatus: input.dbStatus,
    domainScope: createDomainScope(),
    execSql: (async () => []) as ExecSql,
    signingFingerprint: "signing-fingerprint-1",
  });
}

test("database loss reset clears accepted-echo suppression state", () => {
  const state = createContainerContentsStoreState(
    createRuntime({ dbStatus: "ready" }),
    defaultContainerContentsPersistence,
  );
  const unusedSyncAgent = {} as ContainerContentsStoreSyncAgent;

  // Simulate a store that accepted local metadata updates whose remote echo
  // has not arrived yet, plus a pending sync signal.
  state.initialized = true;
  state.locallyAcceptedMetadataUpdateIds.add("update-1");
  state.metadataDocumentIdsNeedingSync.add("metadata-doc-1");
  state.metadataSyncSignalSeqById.set("metadata-doc-1", 3);

  updateContainerContentsStoreRuntime(
    state,
    createRuntime({ dbStatus: "idle" }),
    unusedSyncAgent,
  );

  // After a database loss the tree rehydrates from remote; retained accepted
  // ids would suppress the next matching remote update signal.
  expect(state.initialized).toBe(false);
  expect(state.locallyAcceptedMetadataUpdateIds.size).toBe(0);
  expect(state.metadataDocumentIdsNeedingSync.size).toBe(0);
  expect(state.metadataSyncSignalSeqById.size).toBe(0);
});

test("database loss invalidates hydration without dropping serialization barriers", () => {
  const state = createContainerContentsStoreState(
    createRuntime({ dbStatus: "ready" }),
    defaultContainerContentsPersistence,
  );
  const unusedSyncAgent = {} as ContainerContentsStoreSyncAgent;
  const activeLocalRefresh = Promise.resolve();
  const activeRemoteHydration = Promise.resolve();
  state.initialized = true;
  state.localContainerRefreshGeneration = 0;
  state.localContainerRefreshPromise = activeLocalRefresh;
  state.remoteHydrationGeneration = 0;
  state.remoteHydrationPromise = activeRemoteHydration;

  updateContainerContentsStoreRuntime(
    state,
    createRuntime({ dbStatus: "idle" }),
    unusedSyncAgent,
  );

  expect(state.lifecycleGeneration).toBe(1);
  expect(state.localContainerRefreshPromise).toBe(activeLocalRefresh);
  expect(state.localContainerRefreshGeneration).toBe(0);
  expect(state.remoteHydrationPromise).toBe(activeRemoteHydration);
  expect(state.remoteHydrationGeneration).toBe(0);
});
