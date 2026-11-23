import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type {
  DocumentSyncApi,
  IncomingDocumentSyncUpdateValidator,
} from "../../../data/documents/shared/sync/documentSyncTypes";
import type { DocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import type { DocumentSyncPullContinuation } from "../../../data/documents/shared/sync/syncPagination";
import type {
  DocumentCreateAuthor,
  DocumentWriterPublicKeyResolver,
  PersistedDocumentSyncState,
} from "../../../data/documents/shared/types";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { WorkflowRuntimeUtilInput } from "../../shared/runtimeInput";
import type {
  RemoteDocumentDeletionHandler,
  TerminalSubmitFailureHandler,
} from "../syncFailures/syncFailureClassification";
import type { RekeyPendingUpdate } from "../syncRekeys/syncRecoveryRekey";
import type { DocumentSyncContainerRekeyBuilder } from "./syncAttemptState";
import type { DocumentSyncTraceEmitter } from "./syncTrace";

/** What one `RemoteDocumentService.syncRemoteDocument` call varies. */
export interface SyncRemoteDocumentRequest {
  author: DocumentCreateAuthor;
  /**
   * Supplies a full-history Loro snapshot of the local document so a
   * write-bearing pass can heal a stale content-key bundle by rotating to a
   * fresh content key anchored by a rotation baseline.
   */
  buildRotationSnapshot?: (() => Promise<Uint8Array | null>) | undefined;
  /** Overrides automatic ancestor repair for each submission's current projection. */
  buildContainerRekeys?: DocumentSyncContainerRekeyBuilder;
  documentId: string;
  /** Explicit read-only recovery that bypasses rotation-baseline redirect. */
  historyMode?: "raw" | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  /**
   * The processed cursor recorded with a version `localVersionVector`
   * covers; the server starts the pull after it. A pass that lowers its
   * advertised version to recover conflicted rows drops it.
   */
  processedThroughUpdateId?: string | undefined;
  pullContinuation?: DocumentSyncPullContinuation | undefined;
  /**
   * The document's last pull lost its cursor part way and has to start over,
   * so this pass finishes a pull already under way.
   */
  pullRecoveryRequired?: boolean | undefined;
  /** Atomically commits the verified purge proof with matching local teardown. */
  onRemoteDocumentDeleted?: RemoteDocumentDeletionHandler | undefined;
  onSyncAbandoned?: ((reason: string) => void) | undefined;
  /** Clipboard-safe trace sink (see syncTrace.ts); never receives content. */
  onSyncTrace?: DocumentSyncTraceEmitter | undefined;
  /**
   * Fires when a pass WITHOUT queued writes cannot resolve its writer
   * projection (e.g. a coded 409 from the projection route). Read-only
   * revalidation otherwise fails silently — one burned request and a trace
   * line — leaving the document permanently stale with nothing durable to
   * explain why (edge-case row 13).
   */
  onReadOnlyProjectionFailure?: TerminalSubmitFailureHandler | undefined;
  /** Records a verified response update that could not be decrypted/imported. */
  onIncomingUpdateIsolationFailure?:
    | ((failure: DocumentSyncUpdateIsolationError) => void | Promise<void>)
    | undefined;
  /** Fires immediately before a materialized outgoing batch is submitted. */
  onOutgoingUpdatesMaterialized?:
    | ((updateIds: readonly string[]) => void)
    | undefined;
  /** Invalidates continuation state after the server rejects its snapshot. */
  onPullContinuationInvalidated?:
    | ((continuation: DocumentSyncPullContinuation) => void | Promise<void>)
    | undefined;
  onTerminalSubmitFailure?: TerminalSubmitFailureHandler | undefined;
  pendingUpdates?: readonly PendingUpdateRecord[] | undefined;
  persistedState?: PersistedDocumentSyncState | null | undefined;
  rekeyPendingUpdate?: RekeyPendingUpdate | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveWriterPublicKey: DocumentWriterPublicKeyResolver;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  /** Validates decrypted updates against scratch state before callers persist. */
  validateIncomingUpdates: IncomingDocumentSyncUpdateValidator;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

/**
 * One sync call's request joined with the service's collaborators. The call
 * builds it once and hands the same object to every attempt, so per-pass state
 * can be keyed on its identity (see syncContainerRekeyPreparation.ts).
 */
export interface RemoteDocumentSyncPass extends SyncRemoteDocumentRequest {
  apiClient: DocumentSyncApi;
  execSql: ExecSql;
  isRemoteSyncBlocked?: WorkflowRuntimeUtilInput["isRemoteSyncBlocked"];
  targetSecretKey: Uint8Array;
}
