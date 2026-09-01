import { expect, test } from "bun:test";
import {
  createDocumentsWorkflowRuntime,
  type DocumentSummary,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  openDocumentStore,
  type ResolvedUserIdentity,
  subscribeToPersistedDocuments,
} from "@tearleads/client-sdk";
import { createMockApiClient } from "@tearleads/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { createDeferred } from "../../../test/helpers/databaseRuntimeFactories";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import {
  type ContactsRuntime,
  createContactsStore,
  getSelfContactLocalId,
} from "./contactStore";

const CONTACTS_CONTAINER_ID = "recovered-contacts-container";

async function createRecoveryContactsRuntime(input: {
  containerId?: string;
  runtimeKey?: string;
  signingFingerprint: string;
  userId: string;
}): Promise<ContactsRuntime & { close: () => void }> {
  const runtimeBase = await createSqlRuntimeBase(
    input.runtimeKey ?? "contacts-store-recovery-test",
  );
  const { close, ...runtimeInputBase } = runtimeBase;
  const documents = createDocumentsWorkflowRuntime({
    ...runtimeInputBase,
    apiClient: createMockApiClient(),
    auth: {
      ...runtimeInputBase.auth,
      isAuthenticated: true,
      userId: input.userId,
    },
    crypto: {
      ...runtimeInputBase.crypto,
      signingFingerprint: input.signingFingerprint,
    },
    infra: {
      ...runtimeInputBase.infra,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    },
    state: {
      ...runtimeInputBase.state,
      containerId: input.containerId ?? CONTACTS_CONTAINER_ID,
    },
  });

  return {
    close,
    deleteDocument: async (localId) => {
      await deletePersistedDocument({
        documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
        execSql: documents.infra.execSql,
        localId,
        persistence: defaultDocumentsPersistence,
      });
      return true;
    },
    documents,
    loadDocumentSummary: () => Promise.resolve(null),
    moveDocumentToTrash: () => Promise.resolve(null),
    openDocumentStore: (documentInput) =>
      openDocumentStore(
        documents.state.domainScope,
        documentInput.localId,
        documents,
        documentInput.documentId ?? null,
        documentInput.initialText,
        documentInput.initialDocumentKind,
      ),
    subscribeToPersistedDocuments: (listener) =>
      subscribeToPersistedDocuments(documents.state.domainScope, listener),
  };
}

test("named recovered self contact remains under its remote local id", async () => {
  const selfKey: ResolvedUserIdentity = {
    encapsulationKeyFingerprint: "self-encapsulation-fingerprint",
    encapsulationPublicKey: "self-encapsulation-public-key",
    signingKeyFingerprint: "self-signing-fingerprint",
    signingPublicKey: "self-signing-public-key",
    userId: "self-user",
  };
  const runtime = await createRecoveryContactsRuntime({
    signingFingerprint: selfKey.signingKeyFingerprint,
    userId: selfKey.userId,
  });
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async () => {
      throw new Error("unexpected remote self key fetch");
    },
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });

  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts store did not initialize.",
    );
    const recoveredContactId = await store.createContact({
      encapsulationPublicKey: selfKey.encapsulationPublicKey,
      firstName: "Recovered",
      isSelf: true,
      lastName: "User",
      nickname: "Primary",
      userId: selfKey.userId,
    });
    expect(recoveredContactId).not.toBeNull();

    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .entries.some(
            (entry) => entry.id === recoveredContactId && entry.isSelf,
          ),
      "Recovered self contact did not appear.",
    );
    const contactId = await store.ensureSelfContact({
      encapsulationPublicKey: selfKey.encapsulationPublicKey,
      localId: getSelfContactLocalId(selfKey.signingKeyFingerprint),
      userId: selfKey.userId,
    });
    expect(contactId).toBe(recoveredContactId);
    await waitForCondition(
      () =>
        store.getSnapshot().entries.filter((entry) => entry.isSelf).length ===
          1 && store.getSnapshot().entries[0]?.id === recoveredContactId,
      "Recovered self contact was reseeded under a device-local id.",
    );
    expect(store.getSnapshot().entries[0]).toMatchObject({
      firstName: "Recovered",
      lastName: "User",
      nickname: "Primary",
    });

    const signedOutContactId = await store.ensureSelfContact({
      deferRemoteSync: true,
      localId: getSelfContactLocalId(selfKey.signingKeyFingerprint),
      lookupUserId: selfKey.userId,
    });
    expect(signedOutContactId).toBe(recoveredContactId);
    expect(store.getSnapshot().entries.filter((entry) => entry.isSelf)).toEqual(
      [expect.objectContaining({ id: recoveredContactId })],
    );
  } finally {
    runtime.close();
  }
});

test("late recovered self contact replaces a promoted local fallback", async () => {
  const signingFingerprint = "recovered-self-signing-fingerprint";
  const userId = "recovered-self-user";
  const encapsulationPublicKey = "recovered-self-encapsulation-key";
  const runtime = await createRecoveryContactsRuntime({
    signingFingerprint,
    userId,
  });
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async () => null,
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });

  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts store did not initialize.",
    );
    const localId = getSelfContactLocalId(signingFingerprint);
    await store.ensureSelfContact({
      deferRemoteSync: true,
      encapsulationPublicKey,
      localId,
      userId,
    });
    await waitForCondition(
      () =>
        store
          .getSnapshot()
          .entries.some(
            (entry) => entry.id === localId && entry.userId === userId,
          ),
      "Local self contact was not promoted.",
    );

    const remoteDocumentId = "recovered-self-document";
    const recoveredContact = runtime.openDocumentStore({
      containerId: CONTACTS_CONTAINER_ID,
      documentId: remoteDocumentId,
      initialDocumentKind: "contact",
      localId: remoteDocumentId,
    });
    await recoveredContact.setStructuredFields(
      "contact",
      { encapsulationPublicKey, isSelf: "1", userId },
      { deferRemoteSync: true },
    );
    await waitForCondition(() => {
      const entries = store.getSnapshot().entries;
      return entries.length === 1 && entries[0]?.id === remoteDocumentId;
    }, "Recovered self contact did not replace the local fallback.");
    expect(store.getSnapshot().entries[0]).toMatchObject({
      encapsulationPublicKey,
      id: remoteDocumentId,
      isSelf: true,
      userId,
    });
    await expect(
      defaultDocumentsPersistence.loadDocument(
        runtime.documents.infra.execSql,
        localId,
      ),
    ).resolves.toBeNull();
  } finally {
    runtime.close();
  }
});

test("late recovered self contact purges a remotely synced fallback", async () => {
  const signingFingerprint = "synced-fallback-signing-fingerprint";
  const userId = "synced-fallback-user";
  const encapsulationPublicKey = "synced-fallback-encapsulation-key";
  const localId = getSelfContactLocalId(signingFingerprint);
  const remoteFallbackDocument: DocumentSummary = {
    containerId: CONTACTS_CONTAINER_ID,
    documentId: "synced-fallback-document",
    documentKind: "contact",
    id: localId,
    title: userId,
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
  const baseRuntime = await createRecoveryContactsRuntime({
    runtimeKey: "contacts-store-synced-fallback-test",
    signingFingerprint,
    userId,
  });
  const cleanupOperations: string[] = [];
  const runtime: ContactsRuntime & { close: () => void } = {
    ...baseRuntime,
    deleteDocument: async (deletedLocalId) => {
      cleanupOperations.push(`delete:${deletedLocalId}`);
      return baseRuntime.deleteDocument(deletedLocalId);
    },
    loadDocumentSummary: async (loadedLocalId) =>
      loadedLocalId === localId ? remoteFallbackDocument : null,
    purgeDocument: async (document) => {
      cleanupOperations.push(`purge:${document.documentId}`);
      return true;
    },
  };
  const store = createContactsStore(runtime, {
    resolveUserIdentity: async () => null,
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });

  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts store did not initialize.",
    );
    await store.ensureSelfContact({
      deferRemoteSync: true,
      encapsulationPublicKey,
      localId,
      userId,
    });

    const recoveredDocumentId = "synced-fallback-recovered-document";
    const recoveredContact = runtime.openDocumentStore({
      containerId: CONTACTS_CONTAINER_ID,
      documentId: recoveredDocumentId,
      initialDocumentKind: "contact",
      localId: recoveredDocumentId,
    });
    await recoveredContact.setStructuredFields(
      "contact",
      { encapsulationPublicKey, isSelf: "1", userId },
      { deferRemoteSync: true },
    );

    await waitForCondition(() => {
      const entries = store.getSnapshot().entries;
      return entries.length === 1 && entries[0]?.id === recoveredDocumentId;
    }, "Recovered self contact did not replace the synced fallback.");
    expect(cleanupOperations).toEqual([
      `purge:${remoteFallbackDocument.documentId}`,
      `delete:${localId}`,
    ]);
    await expect(
      defaultDocumentsPersistence.loadDocument(
        runtime.documents.infra.execSql,
        localId,
      ),
    ).resolves.toBeNull();
  } finally {
    runtime.close();
  }
});

test("late self reconciliation stops after an identity lookup crosses runtimes", async () => {
  const staleKey: ResolvedUserIdentity = {
    encapsulationKeyFingerprint: "stale-encapsulation-fingerprint",
    encapsulationPublicKey: "stale-encapsulation-key",
    signingKeyFingerprint: "stale-signing-fingerprint",
    signingPublicKey: "stale-signing-key",
    userId: "stale-user",
  };
  const lookupStarted = createDeferred();
  const lookupResult = createDeferred<ResolvedUserIdentity | null>();
  const staleRuntime = await createRecoveryContactsRuntime({
    runtimeKey: "contacts-store-stale-lookup-runtime",
    signingFingerprint: staleKey.signingKeyFingerprint,
    userId: staleKey.userId,
  });
  const replacementRuntime = await createRecoveryContactsRuntime({
    containerId: "replacement-contacts-container",
    runtimeKey: "contacts-store-replacement-lookup-runtime",
    signingFingerprint: "replacement-signing-fingerprint",
    userId: "replacement-user",
  });
  const store = createContactsStore(staleRuntime, {
    resolveUserIdentity: async () => {
      lookupStarted.resolve(undefined);
      return lookupResult.promise;
    },
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });

  try {
    store.updateRuntime(staleRuntime);
    await waitForCondition(() => store.getSnapshot().ready, "Store not ready.");
    const staleDocumentId = "stale-recovered-self-document";
    const staleContact = staleRuntime.openDocumentStore({
      containerId: CONTACTS_CONTAINER_ID,
      documentId: staleDocumentId,
      initialDocumentKind: "contact",
      localId: staleDocumentId,
    });
    await staleContact.setStructuredFields(
      "contact",
      { isSelf: "1", userId: staleKey.userId },
      { deferRemoteSync: true },
    );
    await lookupStarted.promise;

    store.updateRuntime(replacementRuntime);
    await waitForCondition(
      () =>
        store.getSnapshot().ready && store.getSnapshot().entries.length === 0,
      "Replacement store not ready.",
    );
    lookupResult.resolve(staleKey);
    await lookupResult.promise;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(store.getSnapshot().entries).toEqual([]);
    await expect(
      defaultDocumentsPersistence.loadDocument(
        replacementRuntime.documents.infra.execSql,
        getSelfContactLocalId(staleKey.signingKeyFingerprint),
      ),
    ).resolves.toBeNull();
  } finally {
    lookupResult.resolve(null);
    staleRuntime.close();
    replacementRuntime.close();
  }
});

test("late self reconciliation rechecks its runtime inside the write chain", async () => {
  const staleKey: ResolvedUserIdentity = {
    encapsulationKeyFingerprint: "queued-stale-encapsulation-fingerprint",
    encapsulationPublicKey: "queued-stale-encapsulation-key",
    signingKeyFingerprint: "queued-stale-signing-fingerprint",
    signingPublicKey: "queued-stale-signing-key",
    userId: "queued-stale-user",
  };
  const deleteStarted = createDeferred();
  const releaseDelete = createDeferred();
  const deleteFinished = createDeferred();
  const staleRuntime = await createRecoveryContactsRuntime({
    runtimeKey: "contacts-store-stale-write-runtime",
    signingFingerprint: staleKey.signingKeyFingerprint,
    userId: staleKey.userId,
  });
  const originalDeleteDocument = staleRuntime.deleteDocument;
  const blockedStaleRuntime: ContactsRuntime = {
    ...staleRuntime,
    deleteDocument: async (localId) => {
      deleteStarted.resolve(undefined);
      await releaseDelete.promise;
      try {
        return await originalDeleteDocument(localId);
      } finally {
        deleteFinished.resolve(undefined);
      }
    },
  };
  const replacementRuntime = await createRecoveryContactsRuntime({
    containerId: "queued-replacement-contacts-container",
    runtimeKey: "contacts-store-replacement-write-runtime",
    signingFingerprint: "queued-replacement-signing-fingerprint",
    userId: "queued-replacement-user",
  });
  const store = createContactsStore(blockedStaleRuntime, {
    resolveUserIdentity: async () => {
      throw new Error("unexpected self key fetch");
    },
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });

  try {
    store.updateRuntime(blockedStaleRuntime);
    await waitForCondition(() => store.getSnapshot().ready, "Store not ready.");
    const localId = getSelfContactLocalId(staleKey.signingKeyFingerprint);
    await store.ensureSelfContact({
      deferRemoteSync: true,
      encapsulationPublicKey: staleKey.encapsulationPublicKey,
      localId,
      userId: staleKey.userId,
    });
    const remoteDocumentId = "queued-stale-recovered-document";
    const recoveredContact = blockedStaleRuntime.openDocumentStore({
      containerId: CONTACTS_CONTAINER_ID,
      documentId: remoteDocumentId,
      initialDocumentKind: "contact",
      localId: remoteDocumentId,
    });
    await recoveredContact.setStructuredFields(
      "contact",
      {
        encapsulationPublicKey: staleKey.encapsulationPublicKey,
        isSelf: "1",
        userId: staleKey.userId,
      },
      { deferRemoteSync: true },
    );
    await deleteStarted.promise;

    store.updateRuntime(replacementRuntime);
    await waitForCondition(
      () =>
        store.getSnapshot().ready && store.getSnapshot().entries.length === 0,
      "Replacement store not ready.",
    );
    releaseDelete.resolve(undefined);
    await deleteFinished.promise;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(store.getSnapshot().entries).toEqual([]);
    await expect(
      defaultDocumentsPersistence.loadDocument(
        replacementRuntime.documents.infra.execSql,
        remoteDocumentId,
      ),
    ).resolves.toBeNull();
  } finally {
    releaseDelete.resolve(undefined);
    staleRuntime.close();
    replacementRuntime.close();
  }
});
