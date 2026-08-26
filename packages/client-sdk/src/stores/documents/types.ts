import type { ContainerAccessLevel } from "@symcrypt/crypto";
import type { BlobByteSourceInput } from "../../data/blobContracts";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import type {
  DocumentFieldValidationIssue,
  StoredDocumentKind,
} from "../../data/documents/documentKinds";
import type { DocumentRow } from "../../data/documents/documentRowList";
import type { DocumentSummary } from "../../data/documents/documentSummary";
import type {
  DocumentsWorkflowRuntime,
  RelinkPersistedDocumentInput,
} from "../../workflows/documents";

export const DEFAULT_DOCUMENT_ID = "default";

export type DocumentsRuntime = DocumentsWorkflowRuntime;
export type DocumentStructuredFieldPatch = Readonly<
  Record<string, string | undefined>
>;

export interface DocumentMutationOptions {
  deferRemoteSync?: boolean | undefined;
}

export interface DocumentAttachmentUpload {
  bytes: BlobByteSourceInput;
  name: string;
  mimeType: string | null;
}

export type DocumentAttachmentStatus = "syncing";

// Add a row to the document's repeated-row list, returning the new row id.
export type AddDocumentRow = (
  fields: Readonly<Record<string, string>>,
) => Promise<string>;
// Patch one or more cells of a single row (merges per-cell).
export type UpdateDocumentRowFields = (
  id: string,
  patch: Readonly<Record<string, string>>,
) => Promise<void>;
export type RemoveDocumentRow = (id: string) => Promise<void>;

// The store surface exposed through context: the snapshot fields plus the
// store's mutation methods, spelled as a Pick so the two can't drift.
export type DocumentContextValue = DocumentSnapshot &
  Pick<
    DocumentStore,
    | "addRow"
    | "attachFiles"
    | "relink"
    | "removeAttachment"
    | "removeRow"
    | "replaceAttachment"
    | "requestSync"
    | "setStructuredFields"
    | "setText"
    | "updateRowFields"
  >;

export interface DocumentSnapshot {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: Readonly<Record<string, DocumentAttachmentStatus>>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  canAttach: boolean;
  canWrite: boolean;
  currentAuthorId: string | null;
  documentId: string | null;
  documentKind: StoredDocumentKind;
  effectiveAccessLevel: ContainerAccessLevel;
  fieldValidationIssues: ReadonlyArray<DocumentFieldValidationIssue>;
  ready: boolean;
  rows: ReadonlyArray<DocumentRow>;
  structuredFields: Readonly<Record<string, string>>;
  text: string;
  title: string;
  syncing: boolean;
}

export interface DocumentStore {
  addRow: AddDocumentRow;
  /** Fail unless this store can produce a mergeable full-history checkpoint. */
  assertCanRotateContentKey: () => Promise<Uint8Array>;
  attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) => void;
  /**
   * Convert this document's persisted local state to the discovered-share
   * shell so the store re-pulls the server copy — the escape hatch for
   * queued local writes that can no longer sync. `expectedDocumentId` is
   * revalidated against the persisted record inside the teardown's
   * serialized mutation, so a stale caller can never discard a different
   * identity's edits. Refuses (returns false) local-only, unlinked,
   * move-pending, and identity-mismatched documents.
   */
  discardLocalState: (expectedDocumentId: string) => Promise<boolean>;
  ensureInitialized: () => Promise<boolean>;
  getSnapshot: () => DocumentSnapshot;
  removeAttachment: (slotId: string) => void;
  removeRow: RemoveDocumentRow;
  replaceAttachment: (
    slotId: string,
    file: DocumentAttachmentUpload,
  ) => Promise<void>;
  /** Pull remote document updates even when no websocket event marked it dirty. */
  requestRemoteSync: () => void;
  /** Pull remote updates and report whether the requested sync pass completed. */
  requestRemoteSyncAndWait: (
    signal?: AbortSignal | undefined,
  ) => Promise<boolean>;
  requestSync: () => void;
  relink: (input: DocumentStoreRelinkInput) => Promise<DocumentSummary | null>;
  setStructuredFields: (
    kind: Exclude<StoredDocumentKind, "note">,
    patch: DocumentStructuredFieldPatch,
    options?: DocumentMutationOptions | undefined,
  ) => Promise<void>;
  setText: (value: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  updateRowFields: UpdateDocumentRowFields;
  updateRuntime: (runtime: DocumentsRuntime) => void;
}

export interface DocumentStoreFacade extends DocumentStore {
  rebindTo: (store: DocumentStore) => void;
}

export type PersistedDocumentListener = (document: DocumentSummary) => void;

export interface DocumentStoreRelinkInput extends RelinkPersistedDocumentInput {
  contentKeyBundle?: string | null | undefined;
  documentKekTargets?: string | null | undefined;
  documentManifestBundle?: string | null | undefined;
}
