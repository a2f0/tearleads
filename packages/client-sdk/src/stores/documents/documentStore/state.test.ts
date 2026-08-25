import { expect, test } from "bun:test";
import type { BlobStore } from "../../../data/blobContracts";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsPersistence,
  type DocumentsWorkflowRuntimeInput,
} from "../../../workflows/documents";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import {
  createDocumentStoreState,
  resetDocumentStore,
  setDocumentSnapshot,
  subscribeToDocumentStore,
} from "./state";
import {
  hasPendingIndependentDocumentStoreRemoteSync,
  invalidateDocumentStoreRemoteSync,
  isDocumentStoreRemoteSyncBlocked,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";

function createTestBlobStore(): BlobStore {
  return {
    deleteBytes: async () => undefined,
    openByteSource: async () => null,
    readBytes: async () => null,
    writeByteSource: async () => undefined,
    writeBytes: async () => undefined,
  };
}

function createTestRuntime() {
  return createDocumentsWorkflowRuntime({
    apiClient: {} as DocumentsWorkflowRuntimeInput["apiClient"],
    auth: {
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: createTestBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: (async () => []) as ExecSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: false,
    },
    util: {
      log: () => undefined,
      reportSecurityIncident: async () => undefined,
    },
  });
}

test("setDocumentSnapshot treats missing keys differently from undefined values", () => {
  const state = createDocumentStoreState(
    "undefined-record-key-test",
    createTestRuntime(),
    {} as DocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    null,
  );

  setDocumentSnapshot(state, {
    ...state.snapshot,
    structuredFields: { a: undefined as unknown as string },
  });

  let emits = 0;
  const unsubscribe = subscribeToDocumentStore(state, () => {
    emits += 1;
  });
  setDocumentSnapshot(state, {
    ...state.snapshot,
    structuredFields: { b: undefined as unknown as string },
  });
  unsubscribe();

  expect(emits).toBe(1);
});

test("reset clears cancellation blocking for the next hydration", () => {
  const state = createDocumentStoreState(
    "remote-reset-test",
    createTestRuntime(),
    {} as DocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    "document-1",
  );

  invalidateDocumentStoreRemoteSync(state);
  expect(isDocumentStoreRemoteSyncBlocked(state)).toBe(true);

  resetDocumentStore(state);
  expect(isDocumentStoreRemoteSyncBlocked(state)).toBe(false);
});

test("independent remote ownership spans every pull continuation page", () => {
  const state = createDocumentStoreState(
    "remote-pagination-owner-test",
    createTestRuntime(),
    {} as DocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    "document-1",
  );

  const signalSequence = markDocumentStoreRemoteSyncPending(
    state,
    "independent",
  );
  state.remoteUpdateCompletedSignalSeq = signalSequence;
  state.remoteUpdatePending = false;
  state.pullContinuation = {
    commitLsn: "0/20",
    commitLsnMode: "tracked",
    cursor: "page-2",
  };

  expect(hasPendingIndependentDocumentStoreRemoteSync(state)).toBe(true);

  state.pullContinuation = null;
  expect(hasPendingIndependentDocumentStoreRemoteSync(state)).toBe(false);
});
