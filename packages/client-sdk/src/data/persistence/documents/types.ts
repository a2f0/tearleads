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
 * the chunk `nonceSeed` are base64. `partSize`/`stageId` are filled in once the
 * multipart stage has been opened and remain null before that.
 */
export interface PendingAttachmentUploadIdentity {
  blobId: string;
  contentKey: string;
  contentKeyEpoch: number;
  nonceSeed: string;
  partSize: number | null;
  plaintextSha256: string;
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
  // Set once the slot is unlinked from a synced document and cleared when the
  // slot is written again. The record survives the unlink so the next sync can
  // still detach the remote binding; `detachedAt` is what keeps the local read
  // models from reporting the slot as a live blob reference in the meantime.
  detachedAt: string | null;
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
  findDocumentLocalIdsByContainerId: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<string[]>;
  loadDocument: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<StoredDocumentRecord | null>;
  // Read the authoritative container placement for a locally persisted document
  // straight from its projection row. Returns `undefined` when no projection row
  // exists yet (a first create/discovery persist), so a caller can distinguish
  // that from a row that legitimately carries a null container (a document
  // unlinked from every container). Container placement is owned by the
  // link/tombstone/discovery layer, so a content-metadata persist reads this to
  // avoid republishing a stale in-memory container.
  loadDocumentContainer: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<{ containerId: string | null } | undefined>;
  saveDocument: (
    execSql: ExecSql,
    document: StoredDocumentRecord,
    options?: {
      updatedAt?: string;
    },
  ) => Promise<string>;
  /**
   * Durable full-history support (checkpoint + append-only tail). Optional:
   * implementations that omit these (e.g. container metadata, simple test
   * doubles) simply keep the legacy shallow-snapshot-only behavior.
   */
  appendHistoryUpdates?: (
    execSql: ExecSql,
    input: { localId: string; updates: readonly string[] },
  ) => Promise<void>;
  loadHistoryRestoreState?: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<{
    snapshot: string;
    tailUpdates: readonly string[];
  } | null>;
  readHistoryTailSize?: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<{
    byteLength: number;
    hasCheckpoint: boolean;
    rowCount: number;
  }>;
  listHistoryTailIds?: (execSql: ExecSql, localId: string) => Promise<string[]>;
  replaceHistoryCheckpoint?: (
    execSql: ExecSql,
    input: {
      coveredTailIds: readonly string[];
      localId: string;
      snapshot: string;
    },
  ) => Promise<void>;
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
  rekeyPendingUpdate: (execSql: ExecSql, id: string) => Promise<string | null>;
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
  markLocalAttachmentDetached: (
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
