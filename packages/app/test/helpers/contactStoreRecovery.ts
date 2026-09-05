import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  openDocumentStore,
  subscribeToPersistedDocuments,
} from "@tearleads/client-sdk";
import { createMockApiClient } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../src/document-types/projectors";
import type { ContactsRuntime } from "../../src/stores/contacts/contactStore";
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
