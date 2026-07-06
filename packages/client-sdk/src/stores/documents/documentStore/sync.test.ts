import { expect, test } from "bun:test";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "../../../data/sync/syncCoordinator";
import type { DocumentStoreState } from "./state";
import {
  canClearRemoteUpdateSignalAfterSync,
  handleDocumentRemoteEvents,
  hasRemoteDocumentUpdateEvent,
  registerDocumentStoreSyncLane,
} from "./sync";

function createEventTestState(
  locallyAcceptedUpdateIds: readonly string[],
): DocumentStoreState {
  return {
    locallyAcceptedUpdateIds: new Set(locallyAcceptedUpdateIds),
    record: {
      documentId: "document-1",
    },
  } as DocumentStoreState;
}

function createRemoteEventState(
  events: readonly unknown[],
): DocumentStoreState {
  return {
    lastEventCount: 0,
    locallyAcceptedUpdateIds: new Set<string>(),
    record: { documentId: "document-1" },
    remoteUpdatePending: false,
    remoteUpdateSignalSeq: 0,
    runtime: { state: { events: [...events] } },
  } as unknown as DocumentStoreState;
}

test("hasRemoteDocumentUpdateEvent cleans local echo ids after earlier remote events", () => {
  const state = createEventTestState(["local-update-1"]);

  expect(
    hasRemoteDocumentUpdateEvent(state, [
      {
        documentId: "document-1",
        type: "document_update_created",
      },
      {
        documentId: "document-1",
        type: "document_update_created",
        updateIds: ["local-update-1"],
      },
    ]),
  ).toBe(true);

  expect(state.locallyAcceptedUpdateIds.has("local-update-1")).toBe(false);
});

test("hasRemoteDocumentUpdateEvent cleans local ids from mixed update events", () => {
  const state = createEventTestState(["local-update-1", "local-update-2"]);

  expect(
    hasRemoteDocumentUpdateEvent(state, [
      {
        documentId: "document-1",
        type: "document_update_created",
        updateIds: ["local-update-1", "remote-update-1", "local-update-2"],
      },
    ]),
  ).toBe(true);

  expect([...state.locallyAcceptedUpdateIds]).toEqual([]);
});

test("handleDocumentRemoteEvents bumps the signal sequence when a remote update arrives", () => {
  const state = createRemoteEventState([
    { documentId: "document-1", type: "document_update_created" },
  ]);

  let scheduled = 0;
  handleDocumentRemoteEvents(state, () => {
    scheduled += 1;
  });

  expect(state.remoteUpdatePending).toBe(true);
  // The sequence MUST advance so an in-flight pass that snapshotted seq 0 can
  // detect this fresh signal and refuse to clear it.
  expect(state.remoteUpdateSignalSeq).toBe(1);
  expect(scheduled).toBe(1);
});

// Regression for a convergence-stall race: finalizeDocumentSync used to clear
// remoteUpdatePending unconditionally at the end of a pass, AFTER the network
// GET + persist awaits. A peer update that committed after this pass's GET
// snapshot but whose event arrived during the await would set the signal, then
// be erased by the unconditional clear; the coalesced re-run then skipped (no
// pending signal) and the update was never fetched. The fix snapshots the
// signal sequence at pass entry and only clears when it is unchanged.
test("a remote event arriving mid-pass keeps the signal set so the re-run fetches it", () => {
  // Pass enters and snapshots the current signal sequence.
  const consumedSignalSeq = 0;

  // E2 arrives during the pass's await window: handleDocumentRemoteEvents
  // re-sets the signal and advances the sequence past what the pass consumed.
  const state = createRemoteEventState([
    { documentId: "document-1", type: "document_update_created" },
  ]);
  handleDocumentRemoteEvents(state, () => {});
  expect(state.remoteUpdateSignalSeq).toBe(1);

  // finalizeDocumentSync must NOT clear the signal, because a newer event is
  // pending; otherwise E2 is lost and convergence stalls.
  expect(
    canClearRemoteUpdateSignalAfterSync(
      state.remoteUpdateSignalSeq,
      consumedSignalSeq,
    ),
  ).toBe(false);
});

test("a quiescent pass clears the signal so it does not re-sync forever", () => {
  // No remote event arrived during the pass: the sequence is unchanged from
  // what the pass consumed, so the signal is safely cleared.
  expect(canClearRemoteUpdateSignalAfterSync(3, 3)).toBe(true);
});

function createReadyDocumentSyncState(input: {
  isRemoteSyncBlocked: () => boolean;
  onWriterProjectionRequest: () => void;
}): DocumentStoreState {
  const domainScope = createDomainScope();

  return {
    attachmentBlobIdBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    doc: {} as DocumentStoreState["doc"],
    effects: {
      emitPersistedDocument: () => undefined,
      registerDocumentIdentity: () => undefined,
    },
    initialDocumentId: "remote-document",
    initialDocumentKind: "note",
    initialText: "",
    initializePromise: null,
    initialized: true,
    lastEventCount: 0,
    listeners: new Set(),
    localId: "blocked-sync-note",
    locallyAcceptedUpdateIds: new Set(),
    pendingAttachments: [],
    pendingBaseVersion: null,
    pendingLocalWrites: 0,
    persistence: {} as DocumentStoreState["persistence"],
    record: {
      accessEpoch: 1,
      containerId: "root-container",
      documentId: "remote-document",
      effectiveAccessLevel: "admin",
      id: "blocked-sync-note",
      loroSnapshot: "",
      text: "",
    },
    remoteUpdatePending: true,
    remoteUpdateSignalSeq: 1,
    resolveProjectionUserKey: async () => null,
    runtime: {
      apiClient: {
        getDocumentWriterProjection: async () => {
          input.onWriterProjectionRequest();
          return null;
        },
      } as unknown as DocumentStoreState["runtime"]["apiClient"],
      auth: {
        isAuthenticated: true,
        organizationId: "organization-1",
        userId: "user-1",
      },
      crypto: {
        encapsulationKeyPair: {} as NonNullable<
          DocumentStoreState["runtime"]["crypto"]["encapsulationKeyPair"]
        >,
        signingFingerprint: null,
        signingKeyPair: null,
      },
      infra: {
        blobStore: {} as DocumentStoreState["runtime"]["infra"]["blobStore"],
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql: async () => [],
      },
      state: {
        containerId: "root-container",
        domainScope,
        events: [],
        online: true,
      },
      util: {
        cacheReferencedPrincipalPolicies: async () => undefined,
        isRemoteSyncBlocked: input.isRemoteSyncBlocked,
        log: () => undefined,
      },
    },
    snapshot: {
      attachments: [],
      attachmentStatusBySlotId: {},
      attachmentStorageKeyBySlotId: {},
      canAttach: false,
      canWrite: true,
      documentId: "remote-document",
      documentKind: "note",
      effectiveAccessLevel: "admin",
      fieldValidationIssues: [],
      ready: true,
      structuredFields: {},
      syncing: false,
      text: "",
      title: "",
    },
    syncLane: null,
    writeChain: Promise.resolve(),
    writerProjection: null,
  };
}

test("document sync lane skips API work after an earlier lane trips the remote sync block", async () => {
  let remoteSyncBlocked = false;
  let blockChecks = 0;
  let writerProjectionRequests = 0;
  const state = createReadyDocumentSyncState({
    isRemoteSyncBlocked: () => {
      blockChecks += 1;
      return remoteSyncBlocked;
    },
    onWriterProjectionRequest: () => {
      writerProjectionRequests += 1;
    },
  });
  const coordinator = getOrCreateDomainSyncCoordinator(
    state.runtime.state.domainScope,
  );
  const tripBillingBlockLane = coordinator.registerLane("trip-billing-block", {
    phase: "document",
    run: async () => {
      remoteSyncBlocked = true;
    },
  });
  const documentLane = registerDocumentStoreSyncLane(state);

  tripBillingBlockLane.requestSync();
  documentLane.requestSync();

  await expect(
    waitForDomainSyncCoordinatorToSettle(state.runtime.state.domainScope, {
      timeoutMs: 1_000,
    }),
  ).resolves.toBe(true);
  expect(remoteSyncBlocked).toBe(true);
  expect(blockChecks).toBeGreaterThan(0);
  expect(writerProjectionRequests).toBe(0);
});
