import { expect, test } from "bun:test";
import type { DomainScope } from "../../data/domainScope";
import {
  createDocumentStoreFacade,
  discardRegisteredDocumentLocalState,
  registerDocumentStore,
  registerDocumentStoreIdentity,
  requestRegisteredDocumentRemoteSync,
  subscribeToPersistedDocumentDeletions,
} from "./registry";
import type { DocumentSnapshot, DocumentStore } from "./types";

const READY_SNAPSHOT: DocumentSnapshot = {
  attachments: [],
  attachmentStatusBySlotId: {},
  attachmentStorageKeyBySlotId: {},
  canAttach: false,
  canWrite: true,
  currentAuthorId: null,
  documentId: null,
  documentKind: "note",
  effectiveAccessLevel: "admin",
  fieldValidationIssues: [],
  ready: true,
  rows: [],
  structuredFields: {},
  text: "",
  title: "",
  syncing: false,
};

function createStore(
  onRemoteSync: () => void,
  onDiscard: () => boolean = () => false,
): DocumentStore {
  return {
    addRow: async () => "row-id",
    assertCanRotateContentKey: async () => new Uint8Array(),
    attachFiles: () => undefined,
    discardLocalState: async () => onDiscard(),
    ensureInitialized: async () => true,
    getSnapshot: () => READY_SNAPSHOT,
    removeAttachment: () => undefined,
    removeRow: async () => undefined,
    replaceAttachment: () => undefined,
    requestRemoteSync: onRemoteSync,
    requestSync: () => undefined,
    relink: async () => null,
    setAttachment: () => undefined,
    setStructuredFields: async () => undefined,
    setText: async () => undefined,
    subscribe: () => () => undefined,
    updateRowFields: async () => undefined,
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

test("discardRegisteredDocumentLocalState refuses unopened documents", async () => {
  const domainScope = {} as DomainScope;

  expect(
    await discardRegisteredDocumentLocalState(
      domainScope,
      "unopened-local-id",
      "remote-document-id",
    ),
  ).toBe(false);
});

test("discard routes through the store and emits the deletion on success", async () => {
  const domainScope = {} as DomainScope;
  let discardCalls = 0;
  let discardResult = false;
  const deletedLocalIds: string[] = [];
  const store = createDocumentStoreFacade(
    createStore(
      () => undefined,
      () => {
        discardCalls += 1;
        return discardResult;
      },
    ),
  );
  registerDocumentStore(domainScope, "discard-local-id", store, null);
  const unsubscribe = subscribeToPersistedDocumentDeletions(
    domainScope,
    (localId) => deletedLocalIds.push(localId),
  );
  try {
    expect(
      await discardRegisteredDocumentLocalState(
        domainScope,
        "discard-local-id",
        null,
      ),
    ).toBe(false);
    expect(discardCalls).toBe(1);

    discardResult = true;
    expect(
      await discardRegisteredDocumentLocalState(
        domainScope,
        "discard-local-id",
        null,
      ),
    ).toBe(true);
    expect(discardCalls).toBe(2);
    // Never announced as a deletion: the document survives as a re-seeded
    // shell that keeps its listing entry while the server copy re-downloads.
    expect(deletedLocalIds).toEqual([]);
  } finally {
    unsubscribe();
  }
});
