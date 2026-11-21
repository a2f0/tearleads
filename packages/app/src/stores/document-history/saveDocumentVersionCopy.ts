import type {
  DocumentHistoryView,
  DocumentSummary,
  StoredDocumentKind,
} from "@tearleads/client-sdk";

/**
 * What a copy is born with: a version's kind, text, structured fields, and
 * rows. Attachments are not part of it, as they are not part of a restore: a
 * detached attachment's bytes are not retained.
 */
export type DocumentVersionCopyContent = Pick<
  DocumentHistoryView,
  "documentKind" | "rows" | "structuredFields" | "text"
>;

/** How a copy's document is opened: everything it is born with. */
interface DocumentVersionCopyStoreInput {
  containerId: string;
  initialDocumentKind: StoredDocumentKind;
  initialRows: ReadonlyArray<Readonly<Record<string, string>>>;
  initialStructuredFields: Readonly<Record<string, string>>;
  initialText: string;
  localId: string;
}

/** The part of a document store that creating a copy uses. */
interface DocumentVersionCopyStore {
  ensureInitialized: () => Promise<boolean>;
  getSnapshot: () => {
    documentId: string | null;
    documentKind: StoredDocumentKind;
    ready: boolean;
    title: string;
  };
  requestSync: () => void;
}

/** Opens the store a copy is born in, as a container's `openDocument` does. */
export type OpenDocumentVersionCopy = (
  input: DocumentVersionCopyStoreInput,
) => DocumentVersionCopyStore;

/**
 * Create a new document in `containerId` that starts as `content`, and
 * resolve its summary, or null when the document could not be created.
 *
 * The content is the new document's birth, so it is created by the same path
 * as any other document and shares nothing with the one it was copied from:
 * no history, no identity, and no row ids (each row is born under a new id,
 * in the version's order). The caller decides whether the folder may take it.
 */
export async function saveDocumentVersionCopy(input: {
  containerId: string;
  content: DocumentVersionCopyContent;
  createLocalId: () => string;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  openDocument: OpenDocumentVersionCopy;
}): Promise<DocumentSummary | null> {
  const { containerId, content } = input;
  const localId = input.createLocalId();
  const store = input.openDocument({
    containerId,
    initialDocumentKind: content.documentKind,
    initialRows: content.rows.map((row) => row.fields),
    // A note has no structured fields, and a store refuses to open one with
    // any.
    initialStructuredFields:
      content.documentKind === "note" ? {} : content.structuredFields,
    initialText: content.text,
    localId,
  });
  if (!(await store.ensureInitialized()) || !store.getSnapshot().ready) {
    return null;
  }
  store.requestSync();

  // The document is durable from here on. A summary that cannot be read must
  // not report it as not created: the user would save it a second time.
  const summary = await input.loadDocumentSummary(localId).catch(() => null);
  if (summary !== null) return summary;
  const snapshot = store.getSnapshot();
  return {
    containerId,
    documentId: snapshot.documentId,
    documentKind: snapshot.documentKind,
    id: localId,
    title: snapshot.title,
    updatedAt: new Date().toISOString(),
  };
}
