import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentHistoryView,
  type DocumentSummary,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import { CONTACT_DOCUMENT_KIND } from "../../document-types/contact/contactDocumentDefinition";
import { CONTACT_ACCOUNT_FIELDS } from "../../document-types/contact/contactDocumentModel";
import { AVATAR_PHOTO_FIELD } from "../../document-types/shared/documentPhotos";

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

/**
 * The structured fields a copy is born with: the version's, without those
 * that point at something the copy does not have.
 *
 * - The field naming an attachment slot: the copy holds no attachments, so it
 *   must not point at a photo it lacks.
 * - A contact's account fields. The copy is another contact, and Contacts
 *   finds a person's contact by user id: two contacts answering to one id
 *   would let an import update the copy instead. The key is also the past
 *   version's, which may since have been replaced.
 */
function copiedStructuredFields(
  content: DocumentVersionCopyContent,
): Record<string, string> {
  const left = new Set([
    AVATAR_PHOTO_FIELD,
    ...(content.documentKind === CONTACT_DOCUMENT_KIND
      ? CONTACT_ACCOUNT_FIELDS
      : []),
  ]);
  return Object.fromEntries(
    Object.entries(content.structuredFields).filter(([key]) => !left.has(key)),
  );
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
  // A note has neither structured fields nor rows: a store refuses to open
  // one with fields, and would write its rows without saying so.
  const isNote = content.documentKind === DEFAULT_DOCUMENT_KIND;
  const store = input.openDocument({
    containerId,
    initialDocumentKind: content.documentKind,
    initialRows: isNote ? [] : content.rows.map((row) => row.fields),
    initialStructuredFields: isNote ? {} : copiedStructuredFields(content),
    initialText: content.text,
    localId,
  });
  const readSummary = () =>
    input.loadDocumentSummary(localId).catch(() => null);
  const ready = await store.ensureInitialized().then(
    (initialized) => initialized && store.getSnapshot().ready,
    () => false,
  );
  if (!ready) {
    // Opening commits the document's record before it finishes, so a store
    // that failed to become ready can still have left the document behind.
    // If it did, it is reported: listed, synced, and not saved a second time.
    const left = await readSummary();
    if (left !== null) store.requestSync();
    return left;
  }
  store.requestSync();

  // The document is durable from here on. A summary that cannot be read must
  // not report it as not created: the user would save it a second time.
  const summary = await readSummary();
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
