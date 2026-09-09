import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getUntitledDocumentTitle,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";

/**
 * A local ID also determines the remote create's idempotency key. New documents
 * need globally unique IDs, including blank notes and imported contacts: labels
 * such as "default" or a contact's user ID can belong to many address books.
 * Keep the returned ID for the document's lifetime, including sync retries.
 */
export function createDocumentDraft({
  containerId = null,
  documentKind = DEFAULT_DOCUMENT_KIND,
}: {
  containerId?: string | null | undefined;
  documentKind?: StoredDocumentKind | undefined;
} = {}): DocumentSummary {
  const createdAt = new Date().toISOString();
  return {
    createdAt,
    id: crypto.randomUUID(),
    containerId,
    documentKind,
    documentId: null,
    title: getUntitledDocumentTitle(documentKind),
    updatedAt: createdAt,
  };
}
