import { expect, test } from "bun:test";
import {
  createDocumentStore,
  createDomainScope,
  type DocumentSummary,
  getOrCreateDomainSyncCoordinator,
  openDocumentStore,
  subscribeToPersistedDocuments,
} from "@tearleads/client-sdk";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { cloneDocumentsTestRuntime } from "../../../../test/helpers/document-store/documentStoreSyncFixtures";
import { createDocumentsPersistence } from "../../../../test/helpers/document-store/documentStoreSyncPersistence";
import {
  createRuntime,
  createSqlRuntime,
  documentWorkflowRuntimePatch,
  waitForStoredDocumentText,
} from "../../../../test/helpers/document-store/documentStoreSyncRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";

test("openDocumentStore reuses a synced remote note across different local ids", async () => {
  const runtimeBase = await createSqlRuntime();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const patch = await documentWorkflowRuntimePatch({
    encapsulationKeyPair,
  });
  const runtime = cloneDocumentsTestRuntime(runtimeBase, {
    apiClient: patch.apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: patch.organizationId,
      userId: patch.userId,
    },
    crypto: {
      encapsulationKeyPair,
      signingFingerprint: patch.signingFingerprint,
      signingKeyPair: patch.signingKeyPair,
    },
    state: {
      online: true,
    },
  });

  try {
    const firstStore = openDocumentStore(
      runtime.state.domainScope,
      "note-1",
      runtime,
    );
    await waitForCondition(
      () => firstStore.getSnapshot().ready,
      "First primed document store did not initialize.",
    );

    firstStore.setText("Shared note");
    await waitForStoredDocumentText(runtime, "note-1", "Shared note");
    await waitForCondition(
      () => firstStore.getSnapshot().documentId !== null,
      "First primed document store did not persist its remote document id.",
    );
    const remoteDocumentId = firstStore.getSnapshot().documentId;
    if (!remoteDocumentId) {
      throw new Error("Expected first store to have a remote document id.");
    }

    const secondStore = openDocumentStore(
      runtime.state.domainScope,
      "default",
      runtime,
      remoteDocumentId,
    );

    expect(secondStore).toBe(firstStore);
    expect(secondStore.getSnapshot().text).toBe("Shared note");
    await waitForCondition(
      () => !firstStore.getSnapshot().syncing,
      "Shared document store did not finish syncing before cleanup.",
    );
  } finally {
    runtimeBase.close();
  }
});

test("openDocumentStore collapses live duplicate document facades after remote identity resolves", async () => {
  const runtimeBase = await createSqlRuntime();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const patch = await documentWorkflowRuntimePatch({
    encapsulationKeyPair,
  });
  const runtime = cloneDocumentsTestRuntime(runtimeBase, {
    apiClient: patch.apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: patch.organizationId,
      userId: patch.userId,
    },
    crypto: {
      encapsulationKeyPair,
      signingFingerprint: patch.signingFingerprint,
      signingKeyPair: patch.signingKeyPair,
    },
    state: {
      online: true,
    },
  });

  try {
    const firstStore = openDocumentStore(
      runtime.state.domainScope,
      "note-1",
      runtime,
    );
    const secondStore = openDocumentStore(
      runtime.state.domainScope,
      "default",
      runtime,
      "shared-remote-note",
    );

    expect(secondStore).not.toBe(firstStore);

    await waitForCondition(
      () => firstStore.getSnapshot().ready && secondStore.getSnapshot().ready,
      "Duplicate document facades did not initialize before consolidation.",
    );

    await firstStore.relink({
      accessEpoch: 1,
      accessStateHash: "shared-note-access-state",
      containerId: "root-container",
      documentId: "shared-remote-note",
      localId: "note-1",
    });
    firstStore.setText("Shared note");
    await waitForStoredDocumentText(runtime, "note-1", "Shared note");

    await waitForCondition(
      () =>
        secondStore.getSnapshot().documentId === "shared-remote-note" &&
        secondStore.getSnapshot().text === "Shared note",
      "Live duplicate document facades did not collapse onto the same backing store.",
    );

    secondStore.setText("Merged note");
    await waitForStoredDocumentText(runtime, "note-1", "Merged note");

    await waitForCondition(
      () => firstStore.getSnapshot().text === "Merged note",
      "Collapsed document facades did not share subsequent updates.",
    );
    await waitForCondition(
      () =>
        !firstStore.getSnapshot().syncing && !secondStore.getSnapshot().syncing,
      "Collapsed document facades did not finish syncing before cleanup.",
    );
  } finally {
    runtimeBase.close();
  }
}, 15_000);

test("domain-scoped persisted document subscriptions fan out to multiple listeners", async () => {
  const persistence = createDocumentsPersistence();
  const runtime = createRuntime();
  const firstListenerDocuments: DocumentSummary[] = [];
  const secondListenerDocuments: DocumentSummary[] = [];
  const unsubscribeFirst = subscribeToPersistedDocuments(
    runtime.state.domainScope,
    (document) => {
      firstListenerDocuments.push(document);
    },
  );
  const unsubscribeSecond = subscribeToPersistedDocuments(
    runtime.state.domainScope,
    (document) => {
      secondListenerDocuments.push(document);
    },
  );

  try {
    const store = createDocumentStore("shared-listeners", runtime, persistence);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Document store did not become ready before broadcasting persisted updates.",
    );

    store.setText("Shared note");

    await waitForCondition(
      () =>
        firstListenerDocuments.some(
          (document) => document.title === "Shared note",
        ) &&
        secondListenerDocuments.some(
          (document) => document.title === "Shared note",
        ),
      "Persisted document listeners did not all receive the saved document summary.",
    );
  } finally {
    unsubscribeFirst();
    unsubscribeSecond();
  }
});

test("document store re-registers sync lane when runtime domain scope changes", async () => {
  const persistence = createDocumentsPersistence();
  const firstRuntime = createRuntime();
  const secondRuntime = cloneDocumentsTestRuntime(firstRuntime, {
    state: {
      domainScope: createDomainScope(),
    },
  });
  const store = createDocumentStore(
    "domain-scope-note",
    firstRuntime,
    persistence,
  );
  store.updateRuntime(firstRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Document store did not become ready before the domain scope changed.",
  );

  store.updateRuntime(secondRuntime);

  let oldDomainSyncRequested = false;
  let nextDomainSyncRequested = false;
  getOrCreateDomainSyncCoordinator(firstRuntime.state.domainScope).registerLane(
    "documents:domain-scope-note",
    {
      run: async () => {
        oldDomainSyncRequested = true;
      },
    },
  );
  getOrCreateDomainSyncCoordinator(
    secondRuntime.state.domainScope,
  ).registerLane("documents:domain-scope-note", {
    run: async () => {
      nextDomainSyncRequested = true;
    },
  });

  store.requestSync();

  await waitForCondition(
    () => nextDomainSyncRequested,
    "Document store did not request sync through the updated domain scope.",
  );
  expect(oldDomainSyncRequested).toBe(false);
});

test("document store reloads persisted note text and pending updates", async () => {
  const persistence = createDocumentsPersistence();

  const firstRuntime = createRuntime();
  const firstStore = createDocumentStore("default", firstRuntime, persistence);
  firstStore.updateRuntime(firstRuntime);

  await waitForCondition(
    () => firstStore.getSnapshot().ready,
    "First document store did not become ready.",
  );

  expect(firstStore.getSnapshot()).toEqual({
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
    syncing: false,
    text: "",
    title: "Untitled note",
  });

  firstStore.setText("persisted note");

  await waitForCondition(
    () => persistence.getState().document?.text === "persisted note",
    "Persisted note text was not written.",
  );

  await waitForCondition(
    () => persistence.getState().pendingUpdates.length === 1,
    "Pending note update was not enqueued.",
  );

  const secondRuntime = createRuntime();
  const secondStore = createDocumentStore(
    "default",
    secondRuntime,
    persistence,
  );
  secondStore.updateRuntime(secondRuntime);

  await waitForCondition(
    () => secondStore.getSnapshot().ready,
    "Second document store did not become ready.",
  );

  expect(secondStore.getSnapshot()).toEqual({
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
    syncing: false,
    text: "persisted note",
    title: "persisted note",
  });
});
