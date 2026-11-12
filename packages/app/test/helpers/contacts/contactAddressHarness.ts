import type { DocumentStore } from "@tearleads/client-sdk";
import {
  createDocumentsWorkflowRuntime,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  openDocumentStore,
} from "@tearleads/client-sdk";
import { createMockApiClient } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../src/document-types/projectors";
import { createContactsStore } from "../../../src/stores/contacts/contactStore";
import type { ContactsRuntime } from "../../../src/stores/contacts/contactStoreTypes";
import { createSqlRuntimeBase } from "../createSqlRuntime";

export async function createContactAddressHarness(
  wrap: (store: DocumentStore) => DocumentStore = (store) => store,
) {
  const { close, ...base } = await createSqlRuntimeBase("contact-addresses");
  const documents = createDocumentsWorkflowRuntime({
    ...base,
    apiClient: createMockApiClient(),
    infra: {
      ...base.infra,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    },
    state: { ...base.state, containerId: "contacts" },
  });
  const documentStores = new Map<string, DocumentStore>();
  const deleted: string[] = [];
  const errors: unknown[] = [];
  const runtime: ContactsRuntime = {
    documents,
    deleteDocument: async (localId) => {
      deleted.push(localId);
      await deletePersistedDocument({
        localId,
        execSql: documents.infra.execSql,
        persistence: defaultDocumentsPersistence,
        documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      });
      return true;
    },
    loadDocumentSummary: () => Promise.resolve(null),
    moveDocumentToTrash: () => Promise.resolve(null),
    openDocumentStore: (input) => {
      const store = wrap(
        openDocumentStore(
          documents.state.domainScope,
          input.localId,
          documents,
          input.documentId ?? null,
          input.initialText,
          input.initialDocumentKind,
          { initialStructuredFields: input.initialStructuredFields },
        ),
      );
      documentStores.set(input.localId, store);
      return store;
    },
  };
  const store = createContactsStore(runtime, {
    resolveVerified: () => Promise.resolve(null),
    logError: (message, cause) => {
      errors.push({ message, cause });
    },
  });
  return { close, deleted, documentStores, errors, runtime, store };
}
