import { expect, test } from "bun:test";
import type { DomainScope } from "../../data/shared/domainScope";
import {
  createDocumentStoreFacade,
  discardRegisteredDocumentLocalState,
  getOrCreateDocumentStoreRegistry,
  hasPendingLocalDocumentWrites,
  registerDocumentStore,
  registerDocumentStoreIdentity,
  registerDocumentStoreSupersedeHandler,
  requestRegisteredDocumentRemoteSync,
  resolveDocumentStoreKey,
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
    hasQueuedWrites: () => false,
    hasUnsavedLocalEdits: () => false,
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
    restoreContent: async () => true,
    setStructuredFields: async () => undefined,
    setText: async () => undefined,
    subscribe: () => () => undefined,
    updateRowFields: async () => undefined,
    updateRuntime: () => undefined,
  };
}

test("the facade forwards mutation guards unchanged", async () => {
  const options = { stillCurrent: () => false };
  const fields = { value: "row" };
  const received: unknown[][] = [];
  const target = {
    ...createStore(() => undefined),
    addRow: async (...args: Parameters<DocumentStore["addRow"]>) => {
      received.push(args);
      return "forwarded-row";
    },
    updateRowFields: async (
      ...args: Parameters<DocumentStore["updateRowFields"]>
    ) => {
      received.push(args);
    },
    removeRow: async (...args: Parameters<DocumentStore["removeRow"]>) => {
      received.push(args);
    },
    setStructuredFields: async (
      ...args: Parameters<DocumentStore["setStructuredFields"]>
    ) => {
      received.push(args);
    },
  };
  const facade = createDocumentStoreFacade(target);
  expect(await facade.addRow(fields, options)).toBe("forwarded-row");
  await facade.updateRowFields("row", fields, options);
  await facade.removeRow("row", options);
  await facade.setStructuredFields("contact", fields, options);
  expect(received).toEqual([
    [fields, options],
    ["row", fields, options],
    ["row", options],
    ["contact", fields, options],
  ]);
  for (const args of received) expect(args.at(-1)).toBe(options);
});

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

test("a relink onto an open document id leaves the open view on its record", async () => {
  const domainScope = {} as DomainScope;
  let draftQueued = true;
  const openSnapshot = { ...READY_SNAPSHOT, documentId: "d2", text: "draft" };
  const openTarget = {
    ...createStore(() => undefined),
    getSnapshot: () => openSnapshot,
    hasQueuedWrites: () => draftQueued,
  };
  let stoppedDownloads = 0;
  registerDocumentStoreSupersedeHandler(openTarget, () => {
    stoppedDownloads += 1;
  });
  const openView = createDocumentStoreFacade(openTarget);
  const relinked = createDocumentStoreFacade(createStore(() => undefined));
  registerDocumentStore(domainScope, "open-local", openView, "d2");
  registerDocumentStore(domainScope, "relinked-local", relinked, null);
  let notified = 0;
  openView.subscribe(() => {
    notified += 1;
  });

  registerDocumentStoreIdentity(domainScope, "relinked-local", "d2");

  // The open view still shows its own record, read-only and flagged.
  const snapshot = openView.getSnapshot();
  expect(snapshot).toMatchObject({
    canAttach: false,
    canWrite: false,
    relinkedElsewhere: true,
    text: "draft",
  });
  expect(openView.getSnapshot()).toBe(snapshot);
  expect(notified).toBe(1);
  expect(stoppedDownloads).toBe(1);
  // Reopening either record or the document resolves to the new owner.
  const registry = getOrCreateDocumentStoreRegistry(domainScope);
  for (const [localId, documentId] of [
    ["open-local", "d2"],
    ["relinked-local", null],
    ["open-local", null],
  ] as const) {
    expect(
      registry.storesByKey.get(
        resolveDocumentStoreKey(registry, localId, documentId),
      ),
    ).toBe(relinked);
  }
  // Content writes through the displaced view are refused.
  const refused = { name: "DocumentRelinkedElsewhereError" };
  await expect(openView.setText("more")).rejects.toMatchObject(refused);
  await expect(openView.addRow({ value: "row" })).rejects.toMatchObject(
    refused,
  );
  await expect(
    openView.setStructuredFields("contact", { firstName: "Ada" }),
  ).rejects.toMatchObject(refused);
  expect(
    await openView.restoreContent({
      rows: [],
      structuredFields: {},
      text: "old",
    }),
  ).toBe(false);
  // Its queued draft still holds the page open until it reaches SQLite, and
  // the drained view is then dropped.
  expect(hasPendingLocalDocumentWrites(domainScope)).toBe(true);
  expect(registry.supersededStores.has(openView)).toBe(true);
  draftQueued = false;
  expect(hasPendingLocalDocumentWrites(domainScope)).toBe(false);
  expect(registry.supersededStores.has(openView)).toBe(false);
  openView.supersede();
  expect(stoppedDownloads).toBe(1);
});
