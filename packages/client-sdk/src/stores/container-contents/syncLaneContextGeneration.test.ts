import { expect, mock, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import { createDomainScope } from "../../data/domainScope";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "./state";
import { runContainerContentsStoreSyncIteration } from "./syncLaneIteration";

const contextChanges = [
  { containerId: "root-a", name: "organization", organizationId: "org-b" },
  { containerId: "root-b", name: "root container", organizationId: "org-a" },
] as const;

for (const change of contextChanges) {
  test(`a context ${change.name} change abandons an awaited structural pass`, async () => {
    const domainScope = createDomainScope();
    const execSql = mock(async () => []);
    const keyPair = generateKemSeedAndKeyPair();
    const listPendingCreateIntents = mock(async () => []);
    const persistence: ContainerContentsPersistence = {
      ...defaultContainerContentsPersistence,
      listPendingCreateIntents,
    };
    const originalRuntime = createContainerContentsTestRuntime({
      containerId: "root-a",
      domainScope,
      encapsulationKeyPair: keyPair,
      execSql,
      organizationId: "org-a",
    });
    const replacementRuntime = createContainerContentsTestRuntime({
      containerId: change.containerId,
      domainScope,
      encapsulationKeyPair: keyPair,
      execSql,
      organizationId: change.organizationId,
    });
    const state = createContainerContentsStoreState(
      originalRuntime,
      persistence,
    );
    updateContainerContentsSnapshot(state);
    let releaseRestoration: () => void = () => {
      throw new Error("restoration promise was not initialized");
    };
    let restorationStarted = false;

    const iteration = runContainerContentsStoreSyncIteration({
      host: {
        persistContainerState: async () => {
          throw new Error("the stale pass must not persist container state");
        },
        updateSnapshot: () => updateContainerContentsSnapshot(state),
      },
      reconcileRestoredAccess: (isCurrent) => {
        restorationStarted = true;
        return new Promise<void>((resolve) => {
          releaseRestoration = () => {
            expect(isCurrent()).toBe(false);
            resolve();
          };
        });
      },
      state,
    });

    expect(restorationStarted).toBe(true);
    state.runtime = replacementRuntime;
    releaseRestoration();
    await iteration;

    expect(state.lifecycleGeneration).toBe(0);
    expect(listPendingCreateIntents).not.toHaveBeenCalled();
  });
}
