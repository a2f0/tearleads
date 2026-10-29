import { expect, test } from "bun:test";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  openDocumentStore,
  type ResolvedUserIdentity,
} from "@tearleads/client-sdk";
import { createMockApiClient } from "@tearleads/test-utils";
import { createSqlRuntimeBase } from "../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../test/helpers/waitForCondition";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../document-types/projectors";
import { type ContactsRuntime, createContactsStore } from "./contactStore";

const PEER: ResolvedUserIdentity = {
  encapsulationKeyFingerprint: "peer-encapsulation-fingerprint",
  encapsulationPublicKey: "peer-encapsulation-public-key",
  signingKeyFingerprint: "peer-signing-fingerprint",
  signingPublicKey: "peer-signing-public-key",
  userId: "peer-user",
};

// Opens stores the way the app's Contacts runtime does, initial content
// included, so a created contact's birth is what the store really queues.
async function createBirthRuntime(): Promise<
  ContactsRuntime & { close: () => void }
> {
  const { close, ...base } = await createSqlRuntimeBase("contacts-birth");
  const documents = createDocumentsWorkflowRuntime({
    ...base,
    apiClient: createMockApiClient(),
    auth: { ...base.auth, userId: "self-user" },
    infra: {
      ...base.infra,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    },
    state: { ...base.state, containerId: "contacts-container" },
  });
  return {
    close,
    deleteDocument: async () => true,
    documents,
    loadDocumentSummary: async () => null,
    moveDocumentToTrash: async () => null,
    openDocumentStore: (input) =>
      openDocumentStore(
        documents.state.domainScope,
        input.localId,
        documents,
        input.documentId ?? null,
        input.initialText,
        input.initialDocumentKind,
        {
          initialRows: input.initialRows,
          initialStructuredFields: input.initialStructuredFields,
        },
      ),
  };
}

test("a created or imported contact queues its fields as one update", async () => {
  const runtime = await createBirthRuntime();
  const store = createContactsStore(runtime, {
    resolveVerified: async (userId) => (userId === PEER.userId ? PEER : null),
    logError: (message, cause) => {
      throw new Error(String(message), { cause });
    },
  });
  const queuedUpdateCount = async (localId: string) =>
    (
      await defaultDocumentsPersistence.listPendingUpdates(
        runtime.documents.infra.execSql,
        localId,
      )
    ).length;

  try {
    store.updateRuntime(runtime);
    await waitForCondition(
      () => store.getSnapshot().ready,
      "Contacts store did not initialize.",
    );

    const createdId = await store.createContact({
      firstName: "Ada",
      lastName: "Lovelace",
      nickname: "",
    });
    const importedId = await store.importVerifiedUser(PEER.userId);
    if (!createdId || !importedId) {
      throw new Error("Expected a created and an imported contact.");
    }
    await waitForCondition(
      () =>
        store.getSnapshot().entries.some((entry) => entry.id === createdId) &&
        store.getSnapshot().entries.some((entry) => entry.id === importedId),
      "Contacts did not appear in the store snapshot.",
    );

    // One update each: the birth carries the kind and the fields, so the
    // create can seed it instead of syncing a separate fields update.
    expect(await queuedUpdateCount(createdId)).toBe(1);
    expect(await queuedUpdateCount(importedId)).toBe(1);
    expect(
      store.getSnapshot().entries.find((entry) => entry.id === createdId),
    ).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
    expect(
      store.getSnapshot().entries.find((entry) => entry.id === importedId),
    ).toMatchObject({
      encapsulationPublicKey: PEER.encapsulationPublicKey,
      userId: PEER.userId,
    });
  } finally {
    runtime.close();
  }
});
