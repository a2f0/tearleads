import type { DocumentStore } from "@tearleads/client-sdk";
import {
  createDocumentsWorkflowRuntime,
  openDocumentStore,
} from "@tearleads/client-sdk";
import { createMockApiClient } from "@tearleads/test-utils";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../src/document-types/projectors";
import {
  createContactsStore,
  getSelfContactLocalId,
} from "../../../src/stores/contacts/contactStore";
import type { ContactsRuntime } from "../../../src/stores/contacts/contactStoreTypes";
import { createSqlRuntimeBase } from "../createSqlRuntime";

export async function createContactAddressHarness(
  wrap: (store: DocumentStore) => DocumentStore = (store) => store,
) {
  const { close, ...base } = await createSqlRuntimeBase("contact-addresses");
  const signingFingerprint = "contact-address-self";
  const documents = createDocumentsWorkflowRuntime({
    ...base,
    apiClient: createMockApiClient(),
    crypto: { ...base.crypto, signingFingerprint },
    infra: {
      ...base.infra,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
    },
    state: { ...base.state, containerId: "contacts" },
  });
  const documentStores = new Map<string, DocumentStore>();
  const errors: unknown[] = [];
  const runtime: ContactsRuntime = {
    documents,
    listPendingWrites: async () => [],
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
  return {
    close,
    documentStores,
    errors,
    runtime,
    selfContactId: getSelfContactLocalId(signingFingerprint),
    store,
  };
}
