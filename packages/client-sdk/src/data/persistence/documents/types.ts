import type {
  DocumentProjectorRegistryInput,
  StoredDocumentKind,
} from "../../documents/documentKinds";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../documents/documentSummary";
import type { DocumentSyncPullContinuation } from "../../documents/shared/sync/pullContinuation";
import type { ExecSql } from "../../sqlite/sqlSchema";
import type {
  AttachmentRemovalMarkerSettlement,
  AttachmentRemovalRows,
  AttachmentStagingRows,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  SettleAttachmentRemovalMarkerInput,
} from "./attachmentRecords";
import type { DocumentBirthResult } from "./documentBirthResult";
import type { DocumentDeletionPort } from "./documentDeletionPort";
import type { DocumentOrphanBlobPersistence } from "./orphanBlobPersistence";
import type { QueuedPendingUpdateReplacementPort } from "./queuedUpdateReplacementPort";
import type {
  DocumentRecord as BaseDocumentRecord,
  PendingUpdateFields,
  QueuedPendingUpdateRecord,
} from "./records";
import type { DocumentPeerRebaseInstall } from "./records/peerRebaseInstall";

export type {
  AttachmentRemovalMarkerObservation,
  AttachmentRemovalMarkerSettlement,
  AttachmentRemovalRows,
  AttachmentStagingRows,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingAttachmentUploadIdentity,
  SettleAttachmentRemovalMarkerInput,
} from "./attachmentRecords";
export type {
  DocumentPeerRebaseInstall,
  DocumentPeerRebaseRecord,
} from "./records/peerRebaseInstall";

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
    };

export interface PendingUpdateInsert extends PendingUpdateFields {
  localId: string;
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
  /** Epoch of the verified head; apply refuses a head below local state. */
  accessEpoch: number;
  /** Verified head link set (omits `containerId`); apply needs signed evidence. */
  linkedContainerIds: ReadonlyArray<string>;
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

export interface DocumentsPersistence
  extends QueuedPendingUpdateReplacementPort,
    DocumentDeletionPort<StoredDocumentRecord> {
  readonly orphanBlobs: DocumentOrphanBlobPersistence;
  /**
   * The adapter guarantees that recovery checkpoint replacement, selection of
   * covered local history, rejection of unproven ordinary pending rows, and
   * quarantine of every queued checkpoint artifact share the guarded
   * `commitDocumentMutation` transaction, which also advances the canonical
   * recovery generation. An unrelated history tail not covered by the rebuild
   * must abort that transaction.
   */
  readonly supportsAtomicRecoveryHistoryPruning: boolean;
  /**
   * Move a record onto the fork a peer rebase built, atomically, or write
   * nothing and return false when the record or its history moved past what
   * the rebase read. An adapter without it leaves a peer refusal terminal.
   */
  installPeerRebase?: (
    execSql: ExecSql,
    input: DocumentPeerRebaseInstall,
  ) => Promise<boolean>;
  /**
   * Atomically create the canonical row, standard projections, and birth
   * checkpoint. Returns null when another initializer already owns localId.
   * A remote-alias result refuses a second birth; discovery alone is not
   * authority to adopt the existing record or replace its history.
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
          attachmentNames?: string;
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
  ) => Promise<DocumentBirthResult>;
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
      attachmentNames?: string;
      attachmentRemoval?: AttachmentRemovalRows | undefined;
      attachmentStaging?: AttachmentStagingRows | undefined;
      clearSyncFailure?: boolean | undefined;
      document: StoredDocumentRecord;
      expectedRecord: StoredDocumentRecord;
      historyCheckpoint?:
        | {
            coveredTailIds: readonly string[];
            endVersionVector: string;
            pruneCoveredLocalState: boolean;
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
  /** Settle acknowledged rows while the response's identity, apart from access state, survives. */
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
    expectedRecoveryGeneration: number,
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
  ) => Promise<QueuedPendingUpdateRecord[]>;
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
   * When expectations are supplied, compare the document identity and recovery
   * generation with the canonical row inside that same mutation and return
   * false on absence or mismatch. Adapters must not insert either row.
   */
  enqueuePendingUpdate: (
    execSql: ExecSql,
    pendingUpdate: PendingUpdateInsert,
    options?: {
      expectedDocumentId: string | null;
      expectedRecoveryGeneration: number;
    },
  ) => Promise<boolean>;
  /** Replace a hydrated copy only if its observed durable slot and live document still match. */
  saveHydratedAttachment: (
    execSql: ExecSql,
    input: {
      attachment: LocalAttachmentRecord;
      expectedStorageKey: string | null;
      expectedSnapshotEndVersion: string | null;
      stillCurrent: () => boolean;
    },
  ) => Promise<boolean>;
  /** Settle a removal marker against committed history; see the machine. */
  settleAttachmentRemovalMarker: (
    execSql: ExecSql,
    input: SettleAttachmentRemovalMarkerInput,
  ) => Promise<AttachmentRemovalMarkerSettlement | null>;
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
