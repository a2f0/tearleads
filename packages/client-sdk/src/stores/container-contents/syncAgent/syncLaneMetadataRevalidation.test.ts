import { expect, mock, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createContainerContentsTestRuntime } from "../../../../test/helpers/workflows/containerContentsTestRuntime";
import { createDomainScope } from "../../../data/shared/domainScope";
import { createTestContainerState } from "../../../workflows/container-contents/container-state/containerState.testFixtures";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../../workflows/container-contents/containerPersistence";
import { listContainerMetadataRevalidations } from "../../../workflows/container-contents/metadata/metadataRevalidation";
import type { SyncedContainerMetadataState } from "../../../workflows/container-contents/metadata/metadataTypes";
import type { ContainerState } from "../../../workflows/container-contents/remoteHydration";
import { createPrincipalPolicyOperation } from "../../../workflows/principals/principalPolicyService";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "../state";
import { oweContainerMetadataRead } from "./metadataRevalidation";
import { runContainerContentsStoreSyncIteration } from "./syncLaneIteration";

const EARLIER_PULL = {
  commitLsn: "0/2",
  commitLsnMode: "tracked",
  cursor: "metadata-page-2",
} as const;

/** A completed metadata sync of `folder`, as the metadata workflow returns it. */
function synced(folder: ContainerState): SyncedContainerMetadataState {
  return {
    container: folder.container,
    record: folder.record,
    shouldRequestFollowupSync: false,
  };
}

/**
 * A folder whose metadata a listing owed a read, and a pass runner whose
 * metadata sync records whether each read was forced and, when it resumed the
 * earlier pull, reads that pull's last page.
 */
async function owedFolder(input: { resumesEarlierPull: boolean }) {
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents: async () => [],
    listUnsyncedMoveIntents: async () => [],
  };
  const database = await createTestExecSql(
    `sync-lane-metadata-revalidation-${crypto.randomUUID()}`,
  );
  const runtime = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    execSql: database.execSql,
    organizationId: "org-1",
  });
  const state = createContainerContentsStoreState(runtime, persistence);
  const folder = createTestContainerState({
    id: "folder",
    organizationId: "org-1",
    parentId: null,
  });
  if (input.resumesEarlierPull) folder.record.pullContinuation = EARLIER_PULL;
  const documentId = folder.record.documentId;
  if (typeof documentId !== "string") throw new Error("Expected a document");
  state.containersById.set("folder", folder);
  state.documentStoresNeedPriming = false;
  updateContainerContentsSnapshot(state);
  const followups = mock(() => {});
  state.syncLane = { requestSync: followups } as never;
  await oweContainerMetadataRead(state, documentId);

  const reads: { forced: boolean; resumed: boolean }[] = [];
  const syncContainerMetadata = mock(
    async (sync: { forceReadSync?: boolean }) => {
      reads.push({
        forced: sync.forceReadSync === true,
        resumed: folder.record.pullContinuation != null,
      });
      // This pass reads the earlier pull's last page.
      delete folder.record.pullContinuation;
      return synced(folder);
    },
  );
  const runPass = () =>
    runContainerContentsStoreSyncIteration({
      host: {
        persistContainerState: async () => ({ status: "missing" }),
        updateSnapshot: () => updateContainerContentsSnapshot(state),
      },
      policyOperation: createPrincipalPolicyOperation(),
      reconcileRestoredAccess: async () => {},
      requestRemoteReconciliation: () => {},
      state,
      syncContainerMetadata: syncContainerMetadata as never,
    });
  const owed = async () => ({
    durable: await listContainerMetadataRevalidations(database.execSql),
    queued: state.metadataDocumentIdsNeedingSync.has(documentId),
  });
  return { close: database.close, followups, owed, reads, runPass };
}

test("a fresh forced read pays the debt a listing owed", async () => {
  const folder = await owedFolder({ resumesEarlierPull: false });
  try {
    await folder.runPass();
    expect(folder.reads).toEqual([{ forced: true, resumed: false }]);
    expect(await folder.owed()).toEqual({ durable: [], queued: false });
    expect(folder.followups).not.toHaveBeenCalled();
  } finally {
    folder.close();
  }
});

test("a read that resumes an earlier pull hands the debt to a fresh pull", async () => {
  const folder = await owedFolder({ resumesEarlierPull: true });
  try {
    await folder.runPass();
    expect(folder.reads).toEqual([{ forced: true, resumed: true }]);
    expect(await folder.owed()).toEqual({
      durable: ["metadata-folder"],
      queued: true,
    });
    // The lane must not go idle with the read still owed.
    expect(folder.followups).toHaveBeenCalled();

    await folder.runPass();
    expect(folder.reads).toEqual([
      { forced: true, resumed: true },
      { forced: true, resumed: false },
    ]);
    expect(await folder.owed()).toEqual({ durable: [], queued: false });
  } finally {
    folder.close();
  }
});
