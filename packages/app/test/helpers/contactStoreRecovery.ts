import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  openDocumentStore,
  subscribeToPersistedDocuments,
} from "@tearleads/client-sdk";
import { createMockApiClient } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../src/document-types/projectors";
import {
  type ContactsRuntime,
  getSelfContactLocalId,
} from "../../src/stores/contacts/contactStore";
import { createSqlRuntimeBase } from "./createSqlRuntime";
export const CONTACTS_CONTAINER_ID = "recovered-contacts-container";

export async function createRecoveryContactsRuntime(input: {
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
    documents,
    listPendingWrites: async () => [],
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
        {
          initialRows: documentInput.initialRows,
          initialStructuredFields: documentInput.initialStructuredFields,
        },
      ),
    subscribeToPersistedDocuments: (listener) =>
      subscribeToPersistedDocuments(documents.state.domainScope, listener),
  };
}

// These are DISTINCT documents, not recovery aliases. Matching identity fields
// must never authorize adoption, deletion, or edit redirection between them.
export async function seedDuplicateSelfContacts(runtime: ContactsRuntime) {
  const localId = getSelfContactLocalId("offline-self");
  for (const id of [localId, "recovered-self"]) {
    const doc = runtime.openDocumentStore({
      localId: id,
      initialDocumentKind: "contact",
    });
    await doc.setStructuredFields(
      "contact",
      {
        encapsulationPublicKey: "self-key",
        isSelf: "1",
        userId: "self-user",
        ...(id === "recovered-self" ? { firstName: "Recovered" } : {}),
      },
      { deferRemoteSync: true },
    );
  }
  return localId;
}

// Model identities already admitted to local persistence. This does not grant
// producer permission to create an alias or merge its independently kept log.
export async function setPersistedContactDocumentIdentity(
  runtime: ContactsRuntime,
  localId: string,
  documentId: string,
) {
  const execSql = runtime.documents.infra.execSql;
  const record = await defaultDocumentsPersistence.loadDocument(
    execSql,
    localId,
  );
  if (!record) throw new Error(`Missing seeded contact ${localId}`);
  await defaultDocumentsPersistence.saveDocument(execSql, {
    ...record,
    documentId,
  });
}
