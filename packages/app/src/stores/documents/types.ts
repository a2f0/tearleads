import type { BlobBytes } from "../../data/blobContracts";
import type { DocumentSummary } from "../../data/documentSummary";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import type {
  DocumentsWorkflowRuntime,
  RelinkPersistedDocumentInput,
} from "../../workflows/documents";

const DEFAULT_LOCAL_DOCUMENT_ID = "default";
export const DEFAULT_DOCUMENT_ID = DEFAULT_LOCAL_DOCUMENT_ID;

export type DocumentsRuntime = DocumentsWorkflowRuntime;

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
  documentId: string | null;
  ready: boolean;
  setAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  text: string;
  syncing: boolean;
  setText: (value: string) => void;
}

export interface DocumentSnapshot {
  attachments: ReadonlyArray<DocumentAttachment>;
  attachmentStatusBySlotId: Readonly<Record<string, DocumentAttachmentStatus>>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  canAttach: boolean;
  documentId: string | null;
  ready: boolean;
  text: string;
  syncing: boolean;
}

export interface DocumentStore {
  attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) => void;
  ensureInitialized: () => Promise<boolean>;
  getSnapshot: () => DocumentSnapshot;
  setAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) => void;
  requestSync: () => void;
  relink: (input: DocumentStoreRelinkInput) => Promise<DocumentSummary | null>;
  setText: (value: string) => void;
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
