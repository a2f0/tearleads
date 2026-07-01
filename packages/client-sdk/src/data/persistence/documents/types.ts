import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../documentSummary";
import type { StoredDocumentKind } from "../../documents/documentKinds";
import type {
  DocumentRecord as BaseDocumentRecord,
  PendingUpdateFields,
  PendingUpdateRecord,
} from "../../sqlite/documentPersistence";
import type { ExecSql } from "../../sqlite/sqlSchema";

export type { PendingUpdateRecord } from "../../sqlite/documentPersistence";

export interface StoredDocumentRecord extends BaseDocumentRecord {
  containerId: string | null;
  documentKind?: StoredDocumentKind;
  text: string;
  title?: string;
}

export interface PendingUpdateInsert extends PendingUpdateFields {
  localId: string;
}

/**
 * The identity a pending attachment upload reuses across attempts so a retry
 * (next sync pass or after a restart) reproduces byte-identical encrypted bytes
 * and resumes the same multipart stage instead of orphaning it. `contentKey` and
 * `iv` are base64. `partSize`/`stageId` are filled in once the multipart stage
 * has been opened (null before that, and for one-shot uploads).
 */
export interface PendingAttachmentUploadIdentity {
  blobId: string;
  contentKey: string;
  contentKeyEpoch: number;
  iv: string;
  partSize: number | null;
  stageId: string | null;
}

export interface PendingAttachmentRecord {
  byteLength: number;
  localId: string;
  mimeType: string | null;
  name: string;
  slotId: string;
  storageKey: string;
  upload?: PendingAttachmentUploadIdentity | null;
}

export interface LocalAttachmentRecord {
  blobId: string | null;
  byteLength: number;
  localId: string;
  mimeType: string | null;
  slotId: string;
  storageKey: string;
}

export interface RelinkPersistedDocumentInput {
  accessEpoch: number;
  accessStateHash?: string | null;
  containerId: string;
  documentId: string | null;
  localId: string;
}

export interface ContainerDocumentTombstoneInput {
  containerId: string;
  documentId: string;
  updatedAt: string;
}

export type DocumentSummarySortDirection = "asc" | "desc";
export type DocumentSummarySortKey = "kind" | "title" | "updated";

export interface DocumentSummarySort {
  readonly direction: DocumentSummarySortDirection;
  readonly key: DocumentSummarySortKey;
}

export interface ListDocumentSummariesInput {
  documentKind?: StoredDocumentKind | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sort?: DocumentSummarySort | undefined;
}

export interface DocumentSummaryList {
  readonly rows: ReadonlyArray<DocumentSummary>;
  readonly totalCount: number;
}

export interface DocumentsPersistence {
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  listDocuments: (execSql: ExecSql) => Promise<DocumentSummary[]>;
  listDocumentSummaries: (
    execSql: ExecSql,
    input?: ListDocumentSummariesInput,
  ) => Promise<DocumentSummaryList>;
  listDocumentsByContainerIdsOrDocumentIds: (
    execSql: ExecSql,
    input: {
      containerIds: ReadonlyArray<string>;
      documentIds: ReadonlyArray<string>;
    },
  ) => Promise<DocumentSummary[]>;
  loadDocument: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<StoredDocumentRecord | null>;
  saveDocument: (
    execSql: ExecSql,
    document: StoredDocumentRecord,
    options?: {
      updatedAt?: string;
    },
  ) => Promise<string>;
  saveDocumentAndDeletePendingUpdates: (
    execSql: ExecSql,
    document: StoredDocumentRecord,
    pendingUpdateIds: readonly string[],
    options?: {
      updatedAt?: string;
    },
  ) => Promise<string>;
  deleteDocument: (execSql: ExecSql, localId: string) => Promise<void>;
  upsertDiscoveredDocument: (
    execSql: ExecSql,
    input: DiscoveredDocumentInput,
  ) => Promise<DocumentSummary>;
  relinkPersistedDocument: (
    execSql: ExecSql,
    input: RelinkPersistedDocumentInput,
  ) => Promise<DocumentSummary | null>;
  listPendingUpdates: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<PendingUpdateRecord[]>;
  listPendingAttachments: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<PendingAttachmentRecord[]>;
  listLocalAttachments: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<LocalAttachmentRecord[]>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    pendingUpdate: PendingUpdateInsert,
  ) => Promise<void>;
  saveLocalAttachment: (
    execSql: ExecSql,
    attachment: LocalAttachmentRecord,
  ) => Promise<void>;
  deleteLocalAttachment: (
    execSql: ExecSql,
    localId: string,
    slotId: string,
    storageKey: string,
  ) => Promise<void>;
  savePendingAttachment: (
    execSql: ExecSql,
    attachment: PendingAttachmentRecord,
  ) => Promise<void>;
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
  deletePendingUpdates: (execSql: ExecSql, localId: string) => Promise<void>;
  deletePendingAttachment: (
    execSql: ExecSql,
    localId: string,
    slotId: string,
    storageKey: string,
  ) => Promise<void>;
  deletePendingAttachments: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<void>;
}
