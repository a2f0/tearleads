import type {
  ContainerManifestRef,
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  AccessManifestBundleWireResponse,
  DocumentContentKeyBundleResponse,
  DocumentKekTargetsResponse,
  DocumentPurgeProofResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { ContainerRekeyApi } from "../../../containers/shared/types";
import type { DocumentWriterProjectionAuthorization as WriterAuthorization } from "../../../keyingProjectionVerification";
import type {
  DocumentCreateAuthor,
  DocumentSyncRequestResultOptions,
  PersistedDocumentSyncState,
} from "../types";
import type {
  DocumentSyncImportVerdicts,
  VoidedDocumentSyncUpdate,
} from "./documentUpdateVerdict";
import type { DocumentSyncSubmitFailure } from "./syncSubmitFailure";

export interface DocumentSyncPreparedUpdate {
  checkpointKind?: DocumentOutgoingUpdate["checkpointKind"] | undefined;
  checkpointPayloadKind?:
    | DocumentOutgoingUpdate["checkpointPayloadKind"]
    | undefined;
  ciphertextHash: string;
  contentRecordId?: string | undefined;
  coversThroughUpdateId?: string | undefined;
  encryptedData: string;
  id: string;
  metadataHash: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  plaintextHash: string;
  signedAt?: string | undefined;
  sourceVersionVector?: string | undefined;
}

export interface DocumentEncryptedPendingUpdate {
  contentRecordId: string;
  encryptedData: string;
  metadataHash: string;
  ciphertextHash: string;
  plaintextHash: string;
}

export interface DecryptedDocumentSyncUpdate {
  checkpointKind?: "rotate_baseline";
  checkpointPayloadKind?: "full_history_snapshot";
  id: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  sourceVersionVector?: string;
  updateData: Uint8Array;
}

export interface BuildDocumentSyncPlanInput {
  author: DocumentCreateAuthor;
  authorizingContainerPathRefs?: readonly (readonly ContainerManifestRef[])[];
  containerRekeys?: DocumentSyncRequest["containerRekeys"];
  contentKeyBundle: DocumentContentKeyBundleResponse;
  documentId?: string | undefined;
  documentKekTargets: DocumentKekTargetsResponse;
  documentManifest: AccessManifestBundleWireResponse;
  historyMode?: "raw" | undefined;
  inlineRekeyCommitId?: string | undefined;
  localVersionVector: string | null;
  maxPageUpdates?: number | undefined;
  minLsn?: string | undefined;
  outgoingUpdates?: readonly DocumentSyncPreparedUpdate[] | undefined;
  /**
   * The last update a completed pull reached, sent only with the version it
   * was recorded with; see `processedCursor.ts`. A raw-history request or
   * one without a version vector omits it.
   */
  processedThroughUpdateId?: string | undefined;
  pullCursor?: string | undefined;
  signedAt?: string | undefined;
}

export interface DocumentSyncPlan {
  contentKeyEpoch: number;
  documentId: string;
  documentKekTargets: DocumentKekTargetsResponse;
  documentManifest: AccessManifestBundleWireResponse;
  documentWriterAuthorization?: WriterAuthorization | undefined;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  minLsn?: string | undefined;
  organizationId: string;
  request: DocumentSyncRequest;
  sourceContentKeyBundle: DocumentContentKeyBundleResponse;
}

export interface MaterializedDocumentSyncPlan {
  contentKey: Uint8Array;
  /**
   * True when the plan carries a re-wrapped content-key bundle at the next
   * epoch to heal a stale bundle (a linked container's KEK rotated under it).
   * On submit success the caller must evict this document's cached writer
   * projection so later passes see the healed state instead of re-healing.
   */
  healedStaleContentKeyBundle: boolean;
  /**
   * Pending-queue ids a heal deliberately did NOT submit (superseded rotation
   * checkpoints). On heal success they are reported as settled — the
   * committed covering baseline subsumes their content, and resubmitting them
   * post-heal could mask it as the latest baseline at the healed epoch.
   */
  heldBackPendingUpdateIds: readonly string[];
  plan: DocumentSyncPlan;
  writerProjection: DocumentWriterProjectionResponse;
  /** Synthetic baseline id; its ack does not settle a pending queue row. */
  staleRecoveryBaselineUpdateId?: string;
}

/**
 * Judges a page's decrypted updates against the reader's document, normally
 * with `validateDocumentSyncUpdateImports`, which also checks each payload
 * against its signed span. A validator must return verdicts: the pass fails
 * when it returns anything else.
 */
export type IncomingDocumentSyncUpdateValidator = (
  result: Pick<
    SyncRemoteDocumentResult,
    "contentKeyFingerprintsByEpoch" | "decryptedUpdates" | "response"
  >,
) => DocumentSyncImportVerdicts | Promise<DocumentSyncImportVerdicts>;

export interface SyncRemoteDocumentResult {
  contentKey: Uint8Array;
  /** The served updates this pass accepted, in server order. */
  decryptedUpdates: DecryptedDocumentSyncUpdate[];
  /**
   * Pending updates whose persisted re-key bound is exhausted. Non-zero means
   * a terminal failure was just recorded for them — callers must not treat
   * the pass as clean and clear it.
   */
  exhaustedPendingUpdateCount: number;
  /**
   * True only when this bounded pass made durable progress but left pending
   * work. Headless hosts should refresh the queue and schedule another
   * pass. Terminal exhaustion reports false and uses the failure callback.
   */
  hasDeferredPendingUpdates: boolean;
  /**
   * The pull stopped at an update the Loro runtime failed on and has not
   * settled: the pass applied what came before it, records no cursor, and
   * does not pull again at once. A later pull judges it again.
   */
  hasHeldPull: boolean;
  /** Verified page progress was persisted, but remote pages remain. */
  hasIncompletePull: boolean;
  persistedState: PersistedDocumentSyncState;
  plan: DocumentSyncPlan;
  rekeyedPendingUpdateIds: readonly string[];
  response: DocumentSyncResponse;
  settledPendingUpdateIds: readonly string[];
  acceptedRecoveryBaseline: boolean;
  /**
   * A fingerprint of each content key the pass judged served updates under,
   * by epoch; a void is final only for the key it was judged with.
   */
  contentKeyFingerprintsByEpoch: ReadonlyMap<number, string>;
  /**
   * Served updates this pass will never apply, in server order: each one's
   * payload is not its declared update, or it cannot join the history built
   * from every earlier served update. The pull continues past them.
   */
  voidedUpdates: readonly VoidedDocumentSyncUpdate[];
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

export interface DocumentSyncApi {
  rekeyContainer: ContainerRekeyApi["rekeyContainer"];
  /**
   * Optional status-bearing rekey. Present on the real client; an adapter that
   * omits it still repairs, but a permanent refusal cannot then be told from a
   * transient one and is reported as a plain abandon.
   */
  rekeyContainerResult?: ContainerRekeyApi["rekeyContainerResult"];
  /**
   * Optional. A repair that must carry descendant rekeys reads each one's
   * projection; without this such a repair is refused and the pass abandons.
   */
  getContainerWriterProjection?: ContainerRekeyApi["getContainerWriterProjection"];
  clearWriterProjectionCaches?(): void;
  evictDocumentWriterProjection?(documentId: string): void;
  getDocumentPurgeProof?(
    documentId: string,
    options?: {
      readonly documentCheckpointManifestHash?: string;
    },
    requestOptions?: DocumentSyncRequestResultOptions,
  ): Promise<DocumentPurgeProofResponse | null>;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  getDocumentWriterProjectionResult(
    documentId: string,
    options?: DocumentSyncRequestResultOptions | undefined,
  ): Promise<
    | {
        readonly data: DocumentWriterProjectionResponse;
        readonly ok: true;
      }
    | DocumentSyncSubmitFailure
  >;
  syncDocumentResult(
    documentId: string,
    input: DocumentSyncRequest,
    options?: DocumentSyncRequestResultOptions,
  ): Promise<
    | {
        readonly data: DocumentSyncResponse;
        readonly ok: true;
      }
    | DocumentSyncSubmitFailure
  >;
}
