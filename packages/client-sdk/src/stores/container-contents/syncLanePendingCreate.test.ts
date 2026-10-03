import { expect, mock, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDomainScope } from "../../data/domainScope";
import { createTestContainerState } from "../../workflows/container-contents/container-state/containerState.testFixtures";
import {
  type ContainerContentsPersistence,
  type ContainerCreateIntentRecord,
  defaultContainerContentsPersistence,
} from "../../workflows/container-contents/containerPersistence";
import { createContainerContentsTestRuntime } from "./runtime.testFixtures";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "./state";
import { runContainerContentsStoreSyncIteration } from "./syncLaneIteration";

// A folder whose create has not settled can carry a listed identity that
// adoption has not verified, or has refused: its metadata edits wait for the
// create rather than syncing into that identity.
test("the sync lane skips metadata sync for a folder whose create is pending", async () => {
  const keyPair = generateKemSeedAndKeyPair();
  const parked: ContainerCreateIntentRecord = {
    containerId: "parked",
    createdAt: "2026-10-01T00:00:00.000Z",
    id: "create-parked",
    intentType: "container.create",
    lastAttemptedAt: null,
    lastError: "Container create adoption was refused: signed by another user",
    parentContainerId: "settled",
    remoteContainerId: null,
    remoteMetadataAccessStateHash: null,
    remoteMetadataDocumentId: null,
    syncStatus: "pending",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents: async () => [parked],
    listUnsyncedMoveIntents: async () => [],
  };
  const { execSql, close } = await createTestExecSql(
    "sync-lane-pending-create-metadata",
  );
  const runtime = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    encapsulationKeyPair: keyPair,
    execSql,
    organizationId: "org-1",
  });
  const state = createContainerContentsStoreState(runtime, persistence);
  for (const id of ["settled", "parked"]) {
    state.containersById.set(
      id,
      createTestContainerState({
        id,
        organizationId: "org-1",
        parentId: id === "parked" ? "settled" : null,
      }),
    );
  }
  state.documentStoresNeedPriming = false;
  updateContainerContentsSnapshot(state);
  const syncedIds: string[] = [];
  const syncContainerMetadata = mock(
    async ({
      metadataState,
    }: {
      metadataState: { container: { id: string } };
    }) => {
      syncedIds.push(metadataState.container.id);
      return null;
    },
  );

  try {
    await runContainerContentsStoreSyncIteration({
      host: {
        persistContainerState: async () => ({ status: "missing" }),
        updateSnapshot: () => updateContainerContentsSnapshot(state),
      },
      reconcileRestoredAccess: async () => {},
      requestRemoteReconciliation: () => {},
      state,
      syncContainerMetadata: syncContainerMetadata as never,
    });

    expect(syncedIds).toEqual(["settled"]);
  } finally {
    close();
  }
});
