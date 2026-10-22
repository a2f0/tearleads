import { expect, test } from "bun:test";
import type { DomainScope } from "../../data/shared/domainScope";
import {
  createDocumentStoreFacade,
  discardRegisteredDocumentLocalState,
  getOrCreateDocumentStoreRegistry,
  onDocumentStoreRetired,
  registerDocumentStore,
  registerDocumentStoreIdentity,
  requestRegisteredDocumentRemoteSync,
  retireDocumentStore,
  subscribeToPersistedDocumentDeletions,
  takeRegisteredDocumentStore,
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
    hasQueuedWrites: () => false,
    removeAttachment: () => undefined,
    removeRow: async () => undefined,
    replaceAttachment: () => Promise.resolve(),
    requestRemoteSync: onRemoteSync,
    requestRemoteSyncAndWait: async () => {
      onRemoteSync();
      return true;
    },
    requestSync: () => undefined,
    relink: async () => null,
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

test("discard routes through the store and never emits a deletion", async () => {
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
  registerDocumentStore(
    domainScope,
    "discard-local-id",
    store,
    "discard-remote-id",
  );
  const unsubscribe = subscribeToPersistedDocumentDeletions(
    domainScope,
    (localId) => deletedLocalIds.push(localId),
  );
  try {
    expect(
      await discardRegisteredDocumentLocalState(
        domainScope,
        "discard-local-id",
        "discard-remote-id",
      ),
    ).toBe(false);
    expect(discardCalls).toBe(1);

    discardResult = true;
    expect(
      await discardRegisteredDocumentLocalState(
        domainScope,
        "discard-local-id",
        "discard-remote-id",
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

test("discard refuses when the two identifiers resolve differently", async () => {
  const domainScope = {} as DomainScope;
  let targetDiscards = 0;
  let otherDiscards = 0;
  const targetStore = createDocumentStoreFacade(
    createStore(
      () => undefined,
      () => {
        targetDiscards += 1;
        return true;
      },
    ),
  );
  registerDocumentStore(
    domainScope,
    "target-local",
    targetStore,
    "target-remote",
  );
  const otherStore = createDocumentStoreFacade(
    createStore(
      () => undefined,
      () => {
        otherDiscards += 1;
        return true;
      },
    ),
  );
  registerDocumentStore(domainScope, "other-local", otherStore, "other-remote");

  // A destructive action must never run against whichever store won a
  // lookup priority: mismatched identifiers refuse outright.
  expect(
    await discardRegisteredDocumentLocalState(
      domainScope,
      "target-local",
      "other-remote",
    ),
  ).toBe(false);
  // An UNKNOWN documentId refuses too — the localId alone must not be
  // trusted for a destructive resolution.
  expect(
    await discardRegisteredDocumentLocalState(
      domainScope,
      "target-local",
      "never-registered-remote",
    ),
  ).toBe(false);
  expect(targetDiscards).toBe(0);
  expect(otherDiscards).toBe(0);

  expect(
    await discardRegisteredDocumentLocalState(
      domainScope,
      "target-local",
      "target-remote",
    ),
  ).toBe(true);
  expect(targetDiscards).toBe(1);
  expect(otherDiscards).toBe(0);
});

test("a retired store stays a read-only stand-in until its pause lifts", () => {
  const domainScope = {} as DomainScope;
  let staleSyncs = 0;
  let freshSyncs = 0;
  let laneStopped = false;
  const facade = createDocumentStoreFacade(
    createStore(() => {
      staleSyncs += 1;
    }),
  );
  registerDocumentStore(domainScope, "removed", facade, "remote-removed");
  onDocumentStoreRetired(domainScope, "removed", () => {
    laneStopped = true;
  });

  // A paused organization's cleanup removed the document under the store.
  let paused = true;
  retireDocumentStore(domainScope, "removed", () => paused);
  expect(laneStopped).toBe(true);
  expect(facade.getSnapshot().canWrite).toBe(false);
  expect(
    requestRegisteredDocumentRemoteSync(
      domainScope,
      "removed",
      "remote-removed",
    ),
  ).toBe(false);

  // An editor reopening it while paused gets the stand-in, not a new store
  // that would recreate and download the document.
  const registry = getOrCreateDocumentStoreRegistry(domainScope);
  const freshStore = () =>
    createStore(() => {
      freshSyncs += 1;
    });
  expect(takeRegisteredDocumentStore(registry, "removed", freshStore)).toBe(
    facade,
  );
  expect(facade.getSnapshot().canWrite).toBe(false);

  paused = false;
  expect(takeRegisteredDocumentStore(registry, "removed", freshStore)).toBe(
    facade,
  );
  // Holders of the same facade now reach the fresh store, which syncs again.
  expect(facade.getSnapshot().canWrite).toBe(true);
  expect(
    requestRegisteredDocumentRemoteSync(
      domainScope,
      "removed",
      "remote-removed",
    ),
  ).toBe(true);
  expect({ freshSyncs, staleSyncs }).toEqual({ freshSyncs: 1, staleSyncs: 0 });
});
