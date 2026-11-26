import type { HistorySegmentSizes } from "@tearleads/loro";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type {
  DocumentSyncApi,
  IncomingDocumentSyncUpdateValidator,
} from "../../../data/documents/shared/sync/documentSyncTypes";
import type { DocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import type { PeerRefusal } from "../../../data/documents/shared/sync/peerRefusalRecovery";
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

/**
 * What the host did about a peer refusal.
 *
 * - `rebased`: installed the rebased document and queued its update.
 * - `relayed`: the server lost operations this device saw committed; the
 *   host queued them again under their own peers and left the document as
 *   it was.
 * - `parked`: the server lost such operations on a peer another user now
 *   owns. The queue and the document stay as they are, and a later pass
 *   recovers once that user's device has sent them again. The pass reports
 *   `document_peer_restore_awaits_owner` and abandons; it is not a failure.
 * - `superseded`: lost to a concurrent change of the document, so a later
 *   pass is refused and recovers again.
 * - `nothing_to_cut`: found nothing past the named frontiers, which leaves
 *   the refusal terminal.
 * - `nothing_to_relay`: the server lost such operations and refused a
 *   dependency on them, but the queue already sends them from every
 *   frontier that fell, so the refused request was not this queue. No other
 *   user is waited on, so it is not a park: the pass reports the server's
 *   own refusal as terminal, and the next pass sends the queue.
 */
export type DocumentPeerRebaseOutcome =
  | "nothing_to_cut"
  | "nothing_to_relay"
  | "parked"
  | "rebased"
  | "relayed"
  | "superseded";

/**
 * Recovers from a peer refusal and requests a new sync when the queue
 * changed. It rebases the record's unsent operations on the refused peers
 * onto a fresh peer, or, when a named frontier is below what the device saw
 * committed, relays the lost operations or parks. A rebase or a relay
 * replaces the record's queued updates with one update; every other outcome
 * leaves the queue.
 */
export type DocumentPeerRebaser = (
  refusal: PeerRefusal,
) => Promise<DocumentPeerRebaseOutcome>;

/** What one `RemoteDocumentService.syncRemoteDocument` call varies. */
export interface SyncRemoteDocumentRequest {
  author: DocumentCreateAuthor;
  /**
   * Supplies a full-history Loro snapshot of the local document so a
   * write-bearing pass can heal a stale content-key bundle by rotating to a
   * fresh content key anchored by a rotation baseline.
   */
  buildRotationSnapshot?: (() => Promise<Uint8Array | null>) | undefined;
  /**
   * The sizes a heal cuts its rotation baseline's segments at; Loro's
   * defaults when absent.
   */
  rotationBaselineSegmentSizes?: HistorySegmentSizes | undefined;
  /** Overrides automatic ancestor repair for each submission's current projection. */
  buildContainerRekeys?: DocumentSyncContainerRekeyBuilder;
  documentId: string;
  /** Explicit read-only recovery that bypasses rotation-baseline redirect. */
  historyMode?: "raw" | undefined;
  localVersionVector: string | null;
  /**
   * The most updates a page may hold, while the document isolates updates a
   * process death left unattributed (`loroWindows.ts`).
   */
  maxPageUpdates?: number | undefined;
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
  /**
   * Answers a `document_sync_peer_owned` refusal (another user owns a peer
   * the queued updates extend) or a `document_sync_dependency_uncommitted`
   * one (they depend on an op nobody committed). The pass calls it with the
   * refusal's kind and named frontiers and ends without a result. Without
   * it, either refusal is terminal.
   */
  rebaseOntoFreshPeer?: DocumentPeerRebaser | undefined;
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
