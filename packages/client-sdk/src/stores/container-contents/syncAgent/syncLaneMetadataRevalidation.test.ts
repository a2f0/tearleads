import { expect, mock, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { encodeVersionVectorCounters } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createContainerContentsTestRuntime } from "../../../../test/helpers/workflows/containerContentsTestRuntime";
import { createDomainScope } from "../../../data/shared/domainScope";
import { createTestContainerState } from "../../../workflows/container-contents/container-state/containerState.testFixtures";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../../../workflows/container-contents/containerPersistence";
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
async function owedFolder(input: {
  /** The version the listing advertised; empty when the read reaches it. */
  advertisedVersionVector?: string;
  /** An older pull cursor appears only once the read is under way. */
  continuationInstalledDuringRead?: boolean;
  resetDuringSettle?: boolean;
  resumesEarlierPull: boolean;
  superseded?: boolean;
}) {
  // Store events in order, so a test can see what followed a settlement.
  const events: string[] = [];
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents: async () => [],
    listUnsyncedMoveIntents: async () => [],
    settleContainerMetadataRevalidation: async (execSql, revalidation) => {
      events.push("settle");
      await defaultContainerContentsPersistence.settleContainerMetadataRevalidation(
        execSql,
        revalidation,
      );
      // The store's database is replaced while the delete runs.
      if (input.resetDuringSettle) state.lifecycleGeneration += 1;
    },
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
  await oweContainerMetadataRead(state, {
    advertisedVersionVector: input.advertisedVersionVector ?? "",
    documentId: documentId,
  });

  const reads: { forced: boolean; resumed: boolean }[] = [];
  const syncContainerMetadata = mock(
    async (sync: { forceReadSync?: boolean }) => {
      const resumed =
        folder.record.pullContinuation != null ||
        (input.continuationInstalledDuringRead === true && reads.length === 0);
      reads.push({ forced: sync.forceReadSync === true, resumed });
      // This pass reads the earlier pull's last page.
      delete folder.record.pullContinuation;
      return {
        ...synced(folder),
        ...(resumed ? { resumedEarlierPull: true as const } : {}),
        ...(input.superseded ? { mutationSuperseded: true as const } : {}),
      };
    },
  );
  const runPass = () =>
    runContainerContentsStoreSyncIteration({
      host: {
        persistContainerState: async () => ({ status: "missing" }),
        updateSnapshot: () => {
          events.push("snapshot");
          updateContainerContentsSnapshot(state);
        },
      },
      policyOperation: createPrincipalPolicyOperation(),
      reconcileRestoredAccess: async () => {},
      requestRemoteReconciliation: () => {},
      state,
      syncContainerMetadata: syncContainerMetadata as never,
    });
  const owed = async () => ({
    durable: (
      await persistence.listContainerMetadataRevalidations(database.execSql)
    ).map(({ documentId }) => documentId),
    queued: state.metadataDocumentIdsNeedingSync.has(documentId),
  });
  return { close: database.close, events, followups, owed, reads, runPass };
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

test("a superseded read keeps the debt and its forced follow-up", async () => {
  const folder = await owedFolder({
    resumesEarlierPull: false,
    superseded: true,
  });
  try {
    await folder.runPass();
    expect(await folder.owed()).toEqual({
      durable: ["metadata-folder"],
      queued: true,
    });
    expect(folder.followups).toHaveBeenCalled();
  } finally {
    folder.close();
  }
});

test("a pass whose store is replaced while it settles publishes nothing", async () => {
  const folder = await owedFolder({
    resetDuringSettle: true,
    resumesEarlierPull: false,
  });
  try {
    await folder.runPass();
    const settled = folder.events.indexOf("settle");
    expect(settled).toBeGreaterThanOrEqual(0);
    expect(folder.events.slice(settled + 1)).not.toContain("snapshot");
    expect(folder.followups).not.toHaveBeenCalled();
  } finally {
    folder.close();
  }
});

test("a read settles by the pull it actually resumed, not the one seen at the start", async () => {
  const folder = await owedFolder({
    continuationInstalledDuringRead: true,
    resumesEarlierPull: false,
  });
  try {
    await folder.runPass();
    expect(folder.reads).toEqual([{ forced: true, resumed: true }]);
    expect(await folder.owed()).toEqual({
      durable: ["metadata-folder"],
      queued: true,
    });
    expect(folder.followups).toHaveBeenCalled();
  } finally {
    folder.close();
  }
});

test("a read that does not reach the advertised version keeps the debt without a loop", async () => {
  // A replica lagging the listing answers without the peer's edit.
  const folder = await owedFolder({
    advertisedVersionVector: encodeVersionVectorCounters({ "7": 3 }),
    resumesEarlierPull: false,
  });
  try {
    await folder.runPass();
    expect(await folder.owed()).toEqual({
      durable: ["metadata-folder"],
      queued: true,
    });
    expect(folder.followups).not.toHaveBeenCalled();
  } finally {
    folder.close();
  }
});
