import type {
  DocumentProjectorRegistryInput,
  StoredDocumentKind,
} from "../../documents/documentKinds";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../documents/documentSummary";
import type { DocumentSyncPullContinuation } from "../../documents/shared/pullContinuation";
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

export type DiscardDocumentToShellResult =
  | { discarded: false }
  | {
      discarded: true;
      documentKind: StoredDocumentKind;
      /**
       * Storage keys whose rows the discard deleted — staged uploads plus
       * detached local-attachment markers. Those rows were the only durable
       * pointers to the bytes, so the caller reclaims them.
       */
      reclaimableBlobStorageKeys: ReadonlyArray<string>;
    };

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

export interface AttachmentStagingRows {
  localAttachments: ReadonlyArray<LocalAttachmentRecord>;
  pendingAttachments: ReadonlyArray<PendingAttachmentRecord>;
}

export interface AttachmentRemovalRows {
  mode: "delete" | "detach";
  slotId: string;
  storageKey: string;
}

export interface DocumentHistoryRestoreState {
  snapshot: string;
  tailUpdates: readonly {
    origin: "local" | "remote";
    updateData: string;
  }[];
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
  /**
   * Atomically create the canonical row, standard projections, and birth
   * checkpoint. Returns null when another initializer already owns localId.
   */
  createDocumentWithHistoryCheckpoint: (
    execSql: ExecSql,
    document: StoredDocumentRecord,
    historyCheckpoint: {
      endVersionVector: string;
      snapshot: string;
    },
    options:
      | {
          pendingUpdate?: PendingUpdateFields;
          /** Recheck volatile caller ownership inside the create transaction. */
          stillCurrent?: (() => boolean) | undefined;
          updatedAt?: string;
        }
      | undefined,
    saveClientProjection: (
      transactionExecSql: ExecSql,
      updatedAt: string,
    ) => Promise<void>,
  ) => Promise<string | null>;
  /**
   * Conditionally commit one already-prepared mutation against the exact
   * durable record it was derived from. The identity/progress comparison,
   * attachment and history writes, accepted-queue settlement,
   * canonical/projection save, and client projection callback must share one
   * adapter transaction.
   */
  commitDocumentMutation: (
    execSql: ExecSql,
    input: {
      acceptedPendingUpdateIds: readonly string[];
      attachmentRemoval?: AttachmentRemovalRows | undefined;
      attachmentStaging?: AttachmentStagingRows | undefined;
      clearSyncFailure?: boolean | undefined;
      document: StoredDocumentRecord;
      expectedRecord: StoredDocumentRecord;
      historyCheckpoint?:
        | {
            coveredTailIds: readonly string[];
            endVersionVector: string;
            snapshot: string;
          }
        | undefined;
      historyUpdateOrigin?: "local" | "remote" | undefined;
      historyUpdates?: readonly string[] | undefined;
      pendingUpdate?: PendingUpdateFields | undefined;
      settleAcceptedPendingOnConflict: boolean;
      /**
       * Recheck volatile caller ownership inside the adapter transaction,
       * before any durable side effect. A false result aborts the commit.
       */
      stillCurrent?: (() => boolean) | undefined;
      updatedAt?: string | undefined;
    },
    saveClientProjection: (
      transactionExecSql: ExecSql,
      updatedAt: string,
    ) => Promise<void>,
  ) => Promise<
    | { committed: true; updatedAt: string }
    | { committed: false; currentRecord: StoredDocumentRecord | null }
  >;
  /** Settle acknowledged rows only while the response's security identity survives. */
  settleAcceptedPendingUpdates: (
    execSql: ExecSql,
    input: {
      expectedRecord: StoredDocumentRecord;
      pendingUpdateIds: readonly string[];
    },
  ) => Promise<StoredDocumentRecord | null>;
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
  /**
   * Select one local row for a remote document identity. Prefer any row with
   * queued updates or a deferred-sync frontier, then break duplicates by
   * updatedAt and localId descending.
   */
  findLocalIdByDocumentId: (
    execSql: ExecSql,
    documentId: string,
  ) => Promise<string | null>;
  /** Canonical-row probe; false authorizes destructive orphan teardown. */
  hasDocument: (execSql: ExecSql, localId: string) => Promise<boolean>;
  /** Observe whether the canonical row still names the expected remote stream. */
  documentIdentityMatches: (
    execSql: ExecSql,
    localId: string,
    expectedDocumentId: string | null,
  ) => Promise<boolean>;
  loadDocument: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<StoredDocumentRecord | null>;
  /** Read the canonical record and its history from one database snapshot. */
  loadDocumentWithHistoryRestoreState: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<{
    document: StoredDocumentRecord | null;
    historyRestoreState: DocumentHistoryRestoreState | null;
  }>;
  /** Read every document-store startup row from one database snapshot. */
  loadDocumentStoreState: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<{
    document: StoredDocumentRecord | null;
    historyRestoreState: DocumentHistoryRestoreState | null;
    localAttachments: LocalAttachmentRecord[];
    pendingAttachments: PendingAttachmentRecord[];
  }>;
  /**
   * Atomically replace the exact rejected pull continuation with the durable
   * recovery marker when every supplied sync-identity field still matches.
   * Return the authoritative current record after the compare-and-set, or
   * null when the canonical row no longer exists. A CAS loss returns the
   * winning record so the live store can adopt its newer progress.
   */
  invalidatePullContinuation: (
    execSql: ExecSql,
    input: {
      accessEpoch: number;
      accessStateHash: string | null;
      continuation: DocumentSyncPullContinuation;
      contentKeyBundle: string | null;
      documentId: string;
      documentKekTargets: string | null;
      documentManifestBundle: string | null;
      lastCommitLsn: string | null;
      localId: string;
    },
  ) => Promise<{
    historyRestoreState: DocumentHistoryRestoreState | null;
    record: StoredDocumentRecord;
  } | null>;
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
   * Durable full-history support (checkpoint + append-only tail) — the ONLY
   * persisted content source. REQUIRED: a persistence without these could
   * report successful writes whose documents reopen empty.
   */
  appendHistoryUpdates: (
    execSql: ExecSql,
    input: {
      localId: string;
      origin: "local" | "remote";
      updates: readonly string[];
    },
  ) => Promise<void>;
  loadHistoryRestoreState: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<DocumentHistoryRestoreState | null>;
  readHistoryTailSize: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<{
    byteLength: number;
    hasCheckpoint: boolean;
    rowCount: number;
  }>;
  listHistoryTailEntries: (
    execSql: ExecSql,
    localId: string,
  ) => Promise<{ id: string; updateData: string }[]>;
  replaceHistoryCheckpoint: (
    execSql: ExecSql,
    input: {
      coveredTailIds: readonly string[];
      endVersionVector: string;
      force?: boolean;
      localId: string;
      snapshot: string;
      stillCurrent?: () => boolean;
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
  /**
   * Delete the canonical row and every side row only when its security identity
   * still matches the captured record. The comparison, deletes, and client
   * projection callback must share one write transaction.
   */
  deleteDocumentIfMatches: (
    execSql: ExecSql,
    expectedRecord: StoredDocumentRecord,
    deleteClientProjection: (transactionExecSql: ExecSql) => Promise<void>,
  ) => Promise<boolean>;
  /**
   * Delete orphaned side rows only if the canonical document is still absent.
   * The absence check, row cleanup, and client projection callback must share
   * one write transaction so a concurrent create is preserved.
   */
  deleteDocumentSideRowsIfAbsent: (
    execSql: ExecSql,
    localId: string,
    deleteClientProjection: (transactionExecSql: ExecSql) => Promise<void>,
  ) => Promise<boolean>;
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
  /**
   * Durably append the outgoing row and matching local-history tail entry.
   * When `expectedDocumentId` is supplied, compare it with the canonical row
   * inside that same mutation and return false on absence or mismatch. A false
   * result is an ordinary identity race; adapters must not insert either row.
   */
  enqueuePendingUpdate: (
    execSql: ExecSql,
    pendingUpdate: PendingUpdateInsert,
    options?: { expectedDocumentId: string | null },
  ) => Promise<boolean>;
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
  /**
   * Atomically convert a stuck document's local state to the
   * freshly-discovered-share shell (see the SQL implementation's doc
   * comment). The projector registry clears the document-kind client
   * projection in the same transaction — those tables live with the app's
   * projector definitions, so the CALLER'S registry is required (the default
   * registry knows no app kinds, and a discard that silently kept a
   * contact's or card's projected fields would leak the discarded values).
   * The method itself is optional: implementations without the full document
   * schema (container metadata, simple doubles) simply do not offer the
   * discard escape hatch.
   */
  /**
   * `expectedDocumentId` is revalidated against the loaded record inside the
   * serialized mutation: a stale caller (or a relink that raced the request)
   * must never discard a different identity's edits.
   */
  discardDocumentToShell?: (
    execSql: ExecSql,
    localId: string,
    expectedDocumentId: string,
    documentProjectors: DocumentProjectorRegistryInput,
  ) => Promise<DiscardDocumentToShellResult>;
}
