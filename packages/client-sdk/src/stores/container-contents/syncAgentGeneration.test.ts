import { expect, mock, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { waitFor } from "../../../test/helpers/waitFor";
import { createDomainScope } from "../../data/domainScope";
import {
  disposeDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
  updateContainerContentsStoreRuntime,
} from "./state";
import { createContainerContentsStoreSyncAgent } from "./syncAgent";

test("a reset while restoration awaits stops the stale structural pass", async () => {
  const domainScope = createDomainScope();
  const keyPair = generateKemSeedAndKeyPair();
  const staleExecSql = mock(async () => []);
  const replacementExecSql = mock(async () => []);
  let restorationStarted = false;
  let resolveRestoration: () => void = () => {
    throw new Error("restoration promise was not initialized");
  };
  const listPendingCreateIntents = mock(async () => []);
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    listDormantMetadataSweepRequests: () => {
      restorationStarted = true;
      return new Promise((resolve) => {
        resolveRestoration = () => resolve([]);
      });
    },
    listPendingCreateIntents,
  };
  const readyRuntime = createContainerContentsTestRuntime({
    domainScope,
    encapsulationKeyPair: keyPair,
    execSql: staleExecSql,
  });
  const idleRuntime = createContainerContentsTestRuntime({
    dbStatus: "idle",
    domainScope,
    encapsulationKeyPair: keyPair,
    execSql: replacementExecSql,
  });
  const state = createContainerContentsStoreState(readyRuntime, persistence);
  const syncAgent = createContainerContentsStoreSyncAgent({
    host: {
      persistContainerState: async () => {
        throw new Error("the stale pass must not persist container state");
      },
      requestDocumentPriming: () => {},
      updateSnapshot: () => updateContainerContentsSnapshot(state),
    },
    state,
  });
  updateContainerContentsSnapshot(state);

  try {
    state.syncLane?.requestSync();
    await waitFor(
      () => restorationStarted,
      "Structural sync did not reach restoration.",
    );

    updateContainerContentsStoreRuntime(state, idleRuntime, syncAgent);
    resolveRestoration();
    await waitForDomainSyncCoordinatorToSettle(domainScope);

    expect(listPendingCreateIntents).not.toHaveBeenCalled();
    expect(replacementExecSql).not.toHaveBeenCalled();
  } finally {
    disposeDomainSyncCoordinator(domainScope);
  }
});
