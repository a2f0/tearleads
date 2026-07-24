import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { BlobStore } from "../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import {
  disposeDomainSyncCoordinator,
  getDomainSyncCoordinatorSnapshot,
  waitForDomainSyncCoordinatorToSettle,
} from "../../data/sync/syncCoordinator";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerState } from "../../workflows/container-contents/remoteHydration";
import { createContainerContentsWorkflowRuntime } from "../../workflows/container-contents/runtime";
import {
  bumpMetadataSyncSeq,
  clearMetadataSyncQueueIfUnchanged,
  readMetadataSyncSeq,
} from "./metadataSyncSignal";
import { createContainerContentsStoreState } from "./state";
import { createContainerContentsStoreSyncAgent } from "./syncAgent";

// These tests guard a stale-projection race in the container-contents metadata
// lane. syncSingleContainerMetadata reads `forceReadSync` for a container, then
// awaits a network GET of the container's metadata document. The fix it guards:
// the post-await delete from `metadataDocumentIdsNeedingSync` used to be
// unconditional, so a remote rename/move event that re-queued the SAME
// container during the await would have its re-queue erased — leaving the
// structural projection (name/icon) stale until an unrelated later event
// happened to re-arm it. The lane now snapshots the container's per-id sequence
// from `metadataSyncSignalSeqById` before the GET and only clears when that
// specific id's sequence is unchanged.

interface SignalState {
  metadataDocumentIdsNeedingSync: Set<string>;
  metadataSyncSignalSeqById: Map<string, number>;
}

function createSignalState(queuedIds: readonly string[]): SignalState {
  return {
    metadataDocumentIdsNeedingSync: new Set(queuedIds),
    metadataSyncSignalSeqById: new Map(),
  };
}

// Mirrors what handleRemoteEvents does for a remote metadata update: queue the
// id and advance ITS per-id sequence (not a global counter).
function simulateRemoteMetadataEvent(
  state: SignalState,
  metadataDocumentIds: readonly string[],
): void {
  for (const id of metadataDocumentIds) {
    state.metadataDocumentIdsNeedingSync.add(id);
    bumpMetadataSyncSeq(state.metadataSyncSignalSeqById, id);
  }
}

// Mirrors the post-await clear in syncSingleContainerMetadata.
function clearIfUnchanged(
  state: SignalState,
  id: string,
  consumedSeq: number,
): void {
  clearMetadataSyncQueueIfUnchanged({
    consumedSeqById: new Map([[id, consumedSeq]]),
    id,
    needingSync: state.metadataDocumentIdsNeedingSync,
    seqById: state.metadataSyncSignalSeqById,
  });
}

test("a metadata event arriving mid-pass keeps the container queued for the re-run", () => {
  const state = createSignalState(["container-metadata-1"]);

  // Pass enters and snapshots THIS id's sequence, sees forceReadSync=true.
  const consumedSeq = readMetadataSyncSeq(
    state.metadataSyncSignalSeqById,
    "container-metadata-1",
  );

  // A remote rename of the SAME container lands during the GET await.
  simulateRemoteMetadataEvent(state, ["container-metadata-1"]);
  expect(state.metadataSyncSignalSeqById.get("container-metadata-1")).toBe(1);

  // The pass must NOT clear the queued id: the rename may post-date its GET
  // snapshot, so the coalesced re-run has to fetch it.
  clearIfUnchanged(state, "container-metadata-1", consumedSeq);
  expect(state.metadataDocumentIdsNeedingSync.has("container-metadata-1")).toBe(
    true,
  );
});

// Regression for the per-id requirement (Gemini review on PR #1039): with a
// single global sequence, a remote event for ANY other container during the
// await would block clearing the container actually being synced, causing
// redundant re-sync passes for already-synced containers. With a per-id
// sequence, an unrelated container's event must not affect this one.
test("an unrelated container's mid-pass event does not block clearing this one", () => {
  const state = createSignalState(["container-metadata-1"]);
  const consumedSeq = readMetadataSyncSeq(
    state.metadataSyncSignalSeqById,
    "container-metadata-1",
  );

  // A remote event for a DIFFERENT container lands during the await.
  simulateRemoteMetadataEvent(state, ["container-metadata-OTHER"]);

  // container-metadata-1's own sequence is unchanged, so it clears normally.
  clearIfUnchanged(state, "container-metadata-1", consumedSeq);
  expect(state.metadataDocumentIdsNeedingSync.has("container-metadata-1")).toBe(
    false,
  );
  // The unrelated container stays queued for its own pass.
  expect(
    state.metadataDocumentIdsNeedingSync.has("container-metadata-OTHER"),
  ).toBe(true);
});

test("a quiescent metadata pass clears the queue so it does not re-sync forever", () => {
  const state = createSignalState(["container-metadata-1"]);
  // Pretend prior events advanced this id to seq 2; the pass consumes seq 2.
  state.metadataSyncSignalSeqById.set("container-metadata-1", 2);
  const consumedSeq = 2;

  // No remote event during the await: the id's sequence is unchanged, so
  // clearing is safe and required to stop the lane from looping.
  clearIfUnchanged(state, "container-metadata-1", consumedSeq);
  expect(state.metadataDocumentIdsNeedingSync.size).toBe(0);
});

// A stale-root reassignment rewrites blocked document-move endpoints and
// returns those intents to pending. Replay must happen after that rewrite in
// the same structural run: otherwise this row remains pending with no error
// until some unrelated event requests another pass.
test("one structural request replays a move intent unblocked by stale-root recovery", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-stale-root-move-replay",
  );
  const domainScope = createDomainScope();
  const staleRootId = "deleted-local-root";
  const remoteRootId = "remote-root";
  const documentId = "missing-document";
  const runtimeState = {
    containerId: staleRootId as string | null,
    domainScope,
    events: [],
    online: true,
  };
  const adoptedRoots: string[] = [];

  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId,
      localId: "missing-local-document",
      sourceContainerId: "other-source",
      targetContainerId: staleRootId,
    });
    await sqlDocumentMoveIntentPersistence.recordMoveIntentError(execSql, {
      blocked: true,
      documentId,
      message: "stale root",
    });

    const runtime = createContainerContentsWorkflowRuntime(
      {
        apiClient: createMockApiClient(),
        auth: {
          isAuthenticated: true,
          organizationId: "org-1",
          userId: "user-1",
        },
        crypto: {
          encapsulationKeyPair: generateKemSeedAndKeyPair(),
          signingFingerprint: null,
          signingKeyPair: null,
        },
        infra: {
          blobStore: {} as BlobStore,
          dbStatus: "ready",
          documentProjectors: defaultDocumentProjectorRegistry,
          execSql,
        },
        resolveTrustedUserIdentity: async () => null,
        state: runtimeState,
        util: { log: () => undefined },
      },
      {
        adoptRootContainer: ({ nextContainerId }) => {
          adoptedRoots.push(nextContainerId);
          runtimeState.containerId = nextContainerId;
          return true;
        },
      },
    );
    const state = createContainerContentsStoreState(
      runtime,
      defaultContainerContentsPersistence,
    );
    state.containersById.set(remoteRootId, {
      container: {
        effectiveAccessLevel: "admin",
        icon: null,
        id: remoteRootId,
        metadataDocumentId: "remote-root-metadata",
        name: "/",
        organizationId: "org-1",
        parentId: null,
      },
      doc: {} as ContainerState["doc"],
      record: {
        accessEpoch: 1,
        accessStateHash: "remote-root-access-state",
        contentKeyBundle: "current-content-key-bundle",
        documentId: "remote-root-metadata",
        documentKekTargets: "current-document-kek-targets",
        documentManifestBundle: "current-document-manifest-bundle",
        id: remoteRootId,
        lastCommitLsn: "0/1",
        loroSnapshot: "",
      },
    });
    state.documentStoresNeedPriming = false;
    state.initialized = true;
    state.snapshot = { nodes: [], ready: true };

    const agent = createContainerContentsStoreSyncAgent({
      host: {
        persistContainerState: async () => {
          throw new Error("Unexpected container persist");
        },
        updateSnapshot: () => undefined,
      },
      state,
    });

    agent.scheduleSync();
    expect(
      await waitForDomainSyncCoordinatorToSettle(domainScope, {
        intervalMs: 1,
        quietMs: 0,
        timeoutMs: 1_000,
      }),
    ).toBe(true);

    expect(adoptedRoots).toEqual([remoteRootId]);
    await expect(
      execSql(
        `SELECT source_container_id, target_container_id, sync_status,
                last_error
         FROM document_move_intents
         WHERE document_id = ?`,
        [documentId],
      ),
    ).resolves.toEqual([
      {
        last_error: "Document move intent references a missing local document",
        source_container_id: "other-source",
        sync_status: "blocked",
        target_container_id: remoteRootId,
      },
    ]);

    expect(
      getDomainSyncCoordinatorSnapshot(domainScope).lanes.find(
        (lane) => lane.key === "container-contents",
      ),
    ).toMatchObject({ requestCount: 1, runCount: 1, status: "complete" });
  } finally {
    disposeDomainSyncCoordinator(domainScope);
    close();
  }
});
