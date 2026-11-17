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
import { createPrincipalPolicyOperation } from "../../../workflows/principals/principalPolicyService";
import {
  createContainerContentsStoreState,
  updateContainerContentsSnapshot,
} from "../state";
import { oweContainerMetadataRead } from "./metadataRevalidation";
import { runContainerContentsStoreSyncIteration } from "./syncLaneIteration";

/** One pass over a folder whose metadata a listing owed a read. */
async function passOverOwedFolder(input: { resumesEarlierPull: boolean }) {
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    listPendingCreateIntents: async () => [],
    listUnsyncedMoveIntents: async () => [],
  };
  const { execSql, close } = await createTestExecSql(
    `sync-lane-metadata-revalidation-${crypto.randomUUID()}`,
  );
  try {
    const runtime = createContainerContentsTestRuntime({
      domainScope: createDomainScope(),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      execSql,
      organizationId: "org-1",
    });
    const state = createContainerContentsStoreState(runtime, persistence);
    const folder = createTestContainerState({
      id: "folder",
      organizationId: "org-1",
      parentId: null,
    });
    if (input.resumesEarlierPull) {
      folder.record.pullContinuation = {
        commitLsn: "0/2",
        commitLsnMode: "tracked",
        cursor: "metadata-page-2",
      };
    }
    const documentId = folder.record.documentId;
    if (typeof documentId !== "string") throw new Error("Expected a document");
    state.containersById.set("folder", folder);
    state.documentStoresNeedPriming = false;
    updateContainerContentsSnapshot(state);
    await oweContainerMetadataRead(state, documentId);
    const forced: boolean[] = [];
    const syncContainerMetadata = mock(
      async ({ forceReadSync }: { forceReadSync?: boolean }) => {
        forced.push(forceReadSync === true);
        return { record: { documentId }, shouldRequestFollowupSync: false };
      },
    );
    await runContainerContentsStoreSyncIteration({
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
    return {
      durable: await listContainerMetadataRevalidations(execSql),
      forced,
      queued: state.metadataDocumentIdsNeedingSync.has(documentId),
    };
  } finally {
    close();
  }
}

test("a fresh forced read pays the debt a listing owed", async () => {
  expect(await passOverOwedFolder({ resumesEarlierPull: false })).toEqual({
    durable: [],
    forced: [true],
    queued: false,
  });
});

test("a read that resumes an earlier pull keeps the debt for a fresh pull", async () => {
  const result = await passOverOwedFolder({ resumesEarlierPull: true });
  expect(result.forced).toEqual([true]);
  expect(result.queued).toBe(true);
  expect(result.durable).toHaveLength(1);
});
