import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createContainerContentsTestRuntime } from "../../../../test/helpers/workflows/containerContentsTestRuntime";
import { createDomainScope } from "../../../data/shared/domainScope";
import { defaultContainerContentsPersistence } from "../../../workflows/container-contents/containerPersistence";
import { getOrCreateCreateIntentHoldListings } from "../../../workflows/container-contents/syncLane";
import {
  createContainerContentsStoreState,
  updateContainerContentsStoreRuntime,
} from "../state";
import type { ContainerContentsStoreSyncAgent } from "./syncAgentTypes";

const noopSyncAgent: ContainerContentsStoreSyncAgent = {
  ensureInitialized: () => {},
  handleRemoteEvents: () => {},
  ingestRemoteContainer: async () => {},
  primeDocumentsForSharedSubtree: async () => {},
  refresh: async () => false,
  refreshLocalContainers: async () => {},
  refreshRootLane: async () => false,
  requestRemoteHydration: async () => {},
  scheduleRemoteHydration: () => {},
  scheduleSync: () => {},
};

test("resetting the container contents store runtime clears create-intent hold listings", async () => {
  const { close, execSql } = await createTestExecSql("store-reset-hold-list");
  try {
    const domainScope = createDomainScope();
    const holdListings = getOrCreateCreateIntentHoldListings(domainScope);
    const holdKey = "create-contacts@2026-11-26T12:00:00.000Z";

    expect(holdListings.claim(execSql, holdKey)).toBe(true);
    expect(holdListings.claim(execSql, holdKey)).toBe(false);

    const runtime = createContainerContentsTestRuntime({
      domainScope,
      execSql,
      organizationId: "org-1",
    });
    const state = createContainerContentsStoreState(
      runtime,
      defaultContainerContentsPersistence,
    );
    state.initialized = true;

    updateContainerContentsStoreRuntime(
      state,
      {
        ...runtime,
        infra: { ...runtime.infra, dbStatus: "idle" },
      },
      noopSyncAgent,
    );

    // Same execSql and domainScope: the runtime reset cleared the singleton,
    // so a held create asks for its parent's listing again.
    expect(holdListings.claim(execSql, holdKey)).toBe(true);
  } finally {
    close();
  }
});
