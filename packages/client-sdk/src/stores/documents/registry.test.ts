import { expect, test } from "bun:test";
import type { DomainScope } from "../../data/domainScope";
import {
  createDocumentStoreFacade,
  registerDocumentStore,
  registerDocumentStoreIdentity,
  requestRegisteredDocumentRemoteSync,
} from "./registry";
import type { DocumentSnapshot, DocumentStore } from "./types";

const READY_SNAPSHOT: DocumentSnapshot = {
  attachments: [],
  attachmentStatusBySlotId: {},
  attachmentStorageKeyBySlotId: {},
  canAttach: false,
  canWrite: true,
  documentId: null,
  documentKind: "note",
  effectiveAccessLevel: "admin",
  fieldValidationIssues: [],
  ready: true,
  structuredFields: {},
  text: "",
  title: "",
  syncing: false,
};

function createStore(onRemoteSync: () => void): DocumentStore {
  return {
    assertCanRotateContentKey: async () => new Uint8Array(),
    attachFiles: () => undefined,
    ensureInitialized: async () => true,
    getSnapshot: () => READY_SNAPSHOT,
    removeAttachment: () => undefined,
    replaceAttachment: () => undefined,
    requestRemoteSync: onRemoteSync,
    requestSync: () => undefined,
    relink: async () => null,
    setAttachment: () => undefined,
    setStructuredFields: async () => undefined,
    setText: async () => undefined,
    subscribe: () => () => undefined,
    updateRuntime: () => undefined,
  };
}

test("requestRegisteredDocumentRemoteSync skips unopened documents", () => {
  const domainScope = {} as DomainScope;

  expect(
    requestRegisteredDocumentRemoteSync(
      domainScope,
      "unopened-local-id",
      "remote-document-id",
    ),
  ).toBe(false);
});

test("requestRegisteredDocumentRemoteSync forwards to an active document store", () => {
  const domainScope = {} as DomainScope;
  let remoteSyncCalls = 0;
  const store = createDocumentStoreFacade(
    createStore(() => {
      remoteSyncCalls += 1;
    }),
  );
  registerDocumentStore(domainScope, "active-local-id", store, null);

  expect(
    requestRegisteredDocumentRemoteSync(
      domainScope,
      "unopened-local-id",
      "remote-document-id",
    ),
  ).toBe(false);
  expect(remoteSyncCalls).toBe(0);

  registerDocumentStoreIdentity(
    domainScope,
    "active-local-id",
    "remote-document-id",
  );

  expect(
    requestRegisteredDocumentRemoteSync(
      domainScope,
      "summary-local-id",
      "remote-document-id",
    ),
  ).toBe(true);
  expect(remoteSyncCalls).toBe(1);
});
