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
  setDocumentSnapshot,
  subscribeToDocumentStore,
} from "./state";

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
