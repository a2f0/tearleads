import type { BlobBytes, BlobStore } from "../../data/blobs";
import type { DocumentAttachment } from "../../data/documents/documentContent";
import type { DocumentSummary } from "../../data/documents/shared/documentSummary";
import type { AppDataContextValue } from "../../providers/data/AppDataProvider";
import type { RelinkPersistedDocumentInput } from "../../workflows/documents";

type DocumentAppData = AppDataContextValue;

const DEFAULT_LOCAL_DOCUMENT_ID = "default";
export const DEFAULT_DOCUMENT_ID = DEFAULT_LOCAL_DOCUMENT_ID;

export interface DocumentsRuntime {
  apiClient: DocumentAppData["apiClient"];
  blobStore: BlobStore;
  cacheReferencedPrincipalPolicies: DocumentAppData["cacheReferencedPrincipalPolicies"];
  containerId: DocumentAppData["containerId"];
  dbStatus: DocumentAppData["dbStatus"];
  domainScope: DocumentAppData["domainScope"];
  encapsulationKeyPair: DocumentAppData["encapsulationKeyPair"];
  events: DocumentAppData["events"];
  execSql: DocumentAppData["execSql"];
  isAuthenticated: DocumentAppData["isAuthenticated"];
  log: DocumentAppData["log"];
  online: DocumentAppData["online"];
  organizationId?: DocumentAppData["organizationId"];
  signingFingerprint?: DocumentAppData["signingFingerprint"];
  signingKeyPair?: DocumentAppData["signingKeyPair"];
  userId?: DocumentAppData["userId"];
}

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
