import type {
  ContainerManifestRef,
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  AccessManifestBundleWireResponse,
  DocumentContentKeyBundleResponse,
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
import type { DocumentSyncSubmitFailure } from "./syncSubmitFailure";

export interface DocumentSyncPreparedUpdate {
  checkpointKind?: DocumentOutgoingUpdate["checkpointKind"] | undefined;
  checkpointPayloadKind?:
    | DocumentOutgoingUpdate["checkpointPayloadKind"]
    | undefined;
  ciphertextHash: string;
  contentRecordId?: string | undefined;
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

export interface ParsedDocumentEncryptedUpdate {
  ciphertext: Uint8Array;
  contentKeyEpoch: number;
  contentRecordId: string;
  metadataHash: string;
  nonceDomainHash: string;
  iv: Uint8Array;
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
  documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  documentManifest: AccessManifestBundleWireResponse;
  historyMode?: "raw" | undefined;
  inlineRekeyCommitId?: string | undefined;
  localVersionVector: string | null;
  minLsn?: string | undefined;
  outgoingUpdates?: readonly DocumentSyncPreparedUpdate[] | undefined;
  pullCursor?: string | undefined;
  signedAt?: string | undefined;
}

export interface DocumentSyncPlan {
  contentKeyEpoch: number;
  documentId: string;
  documentKekTargets: DocumentSyncResponse["documentKekTargets"];
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

export interface SyncRemoteDocumentResult {
  contentKey: Uint8Array;
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
  /** Verified page progress was persisted, but remote pages remain. */
  hasIncompletePull: boolean;
  persistedState: PersistedDocumentSyncState;
  plan: DocumentSyncPlan;
  rekeyedPendingUpdateIds: readonly string[];
  response: DocumentSyncResponse;
  settledPendingUpdateIds: readonly string[];
  acceptedRecoveryBaseline: boolean;
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
