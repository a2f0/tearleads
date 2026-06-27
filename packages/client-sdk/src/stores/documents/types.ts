import type { ContainerAccessLevel } from "@tearleads/crypto";
import type { BlobBytes } from "../../data/blobContracts";
import type { DocumentSummary } from "../../data/documentSummary";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import type {
  DocumentFieldValidationIssue,
  StoredDocumentKind,
} from "../../data/documents/documentKinds";
import type {
  DocumentsWorkflowRuntime,
  RelinkPersistedDocumentInput,
} from "../../workflows/documents";

const DEFAULT_LOCAL_DOCUMENT_ID = "default";
export const DEFAULT_DOCUMENT_ID = DEFAULT_LOCAL_DOCUMENT_ID;

export type DocumentsRuntime = DocumentsWorkflowRuntime;
export type DocumentStructuredFieldPatch = Readonly<
  Record<string, string | undefined>
>;

export interface DocumentAttachmentUpload {
  bytes: BlobBytes;
  name: string;
  mimeType: string | null;
}

export type DocumentAttachmentStatus = "syncing";

export interface DocumentContextValue {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: Readonly<Record<string, DocumentAttachmentStatus>>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) => void;
  canAttach: boolean;
  canWrite: boolean;
  documentId: string | null;
  documentKind: StoredDocumentKind;
  effectiveAccessLevel: ContainerAccessLevel;
  fieldValidationIssues: ReadonlyArray<DocumentFieldValidationIssue>;
  ready: boolean;
  requestSync: () => void;
  relink: (input: DocumentStoreRelinkInput) => Promise<DocumentSummary | null>;
  removeAttachment: (slotId: string) => void;
  setAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  setStructuredFields: (
    kind: Exclude<StoredDocumentKind, "note">,
    patch: DocumentStructuredFieldPatch,
  ) => Promise<void>;
  structuredFields: Readonly<Record<string, string>>;
  text: string;
  title: string;
  syncing: boolean;
  setText: (value: string) => Promise<void>;
}

export interface DocumentSnapshot {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: Readonly<Record<string, DocumentAttachmentStatus>>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  canAttach: boolean;
  canWrite: boolean;
  documentId: string | null;
  documentKind: StoredDocumentKind;
  effectiveAccessLevel: ContainerAccessLevel;
  fieldValidationIssues: ReadonlyArray<DocumentFieldValidationIssue>;
  ready: boolean;
  structuredFields: Readonly<Record<string, string>>;
  text: string;
  title: string;
  syncing: boolean;
}

export interface DocumentStore {
  attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) => void;
  ensureInitialized: () => Promise<boolean>;
  getSnapshot: () => DocumentSnapshot;
  removeAttachment: (slotId: string) => void;
  setAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  /** Pull remote document updates even when no websocket event marked it dirty. */
  requestRemoteSync: () => void;
  requestSync: () => void;
  relink: (input: DocumentStoreRelinkInput) => Promise<DocumentSummary | null>;
  setStructuredFields: (
    kind: Exclude<StoredDocumentKind, "note">,
    patch: DocumentStructuredFieldPatch,
  ) => Promise<void>;
  setText: (value: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: DocumentsRuntime) => void;
}

export interface DocumentStoreFacade extends DocumentStore {
  rebindTo: (store: DocumentStore) => void;
}

export type PersistedDocumentListener = (document: DocumentSummary) => void;

export interface DocumentStoreRelinkInput extends RelinkPersistedDocumentInput {
  queueBaselineAfterRelink?: boolean | undefined;
  contentKeyBundle?: string | null | undefined;
  documentKekTargets?: string | null | undefined;
  documentManifestBundle?: string | null | undefined;
}
