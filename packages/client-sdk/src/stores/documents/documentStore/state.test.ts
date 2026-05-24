import { expect, test } from "bun:test";
import type { BlobStore } from "../../../data/blobContracts";
import { createDomainScope } from "../../../data/domainScope";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  createDocumentsWorkflowRuntime,
  type DocumentsPersistence,
  type DocumentsWorkflowRuntimeInput,
} from "../../../workflows/documents";
import {
  createDocumentStoreState,
  setDocumentSnapshot,
  subscribeToDocumentStore,
} from "./state";

function createTestBlobStore(): BlobStore {
  return {
    deleteBytes: async () => undefined,
    readBytes: async () => null,
    writeBytes: async () => undefined,
  };
}

function createTestRuntime() {
  return createDocumentsWorkflowRuntime({
    apiClient: {} as DocumentsWorkflowRuntimeInput["apiClient"],
    blobStore: createTestBlobStore(),
    cacheReferencedPrincipalPolicies: async () => undefined,
    dbStatus: "ready",
    domainScope: createDomainScope(),
    events: [],
    execSql: (async () => []) as ExecSql,
    isAuthenticated: false,
    log: () => undefined,
    online: false,
  });
}

test("setDocumentSnapshot treats missing keys differently from undefined values", () => {
  const state = createDocumentStoreState(
    "undefined-record-key-test",
    createTestRuntime(),
    {} as DocumentsPersistence,
    {
      emitPersistedDocument: () => undefined,
      registerDocumentIdentity: () => undefined,
    },
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
