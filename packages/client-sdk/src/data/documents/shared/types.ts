import type {
  AccessEvent,
  AccessManifest,
  DocumentContentKeyTarget,
  DocumentLinkAccessEventBody,
  DocumentLinkSetManifestState,
  DocumentUnlinkAccessEventBody,
} from "@tearleads/crypto";
import type {
  ContainerManifestRef,
  DocumentContentKeyTargetEnvelope,
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentPurgeProofResponse,
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { ContainerMutationAuthor } from "../../containers/shared/types";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
  DocumentWriterProjectionAuthorization as WriterAuthorization,
} from "../../keyingProjectionVerification";
import { requireProjectionUserKeyResolver } from "../../keyingProjectionVerification";
import type { DocumentRecord } from "../../sqlite/documentPersistence";
import type { ExecSql } from "../../sqlite/sqlSchema";
import type { DocumentSyncSubmitFailure } from "./syncSubmitFailure";

export type { DocumentSyncSubmitFailure } from "./syncSubmitFailure";

export const DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT =
  "tearleads.document.loro-update";
export const DOCUMENT_CONTENT_RECORD_KEY_INFO_DOMAIN =
  "tearleads.document.content-record-key-info";
export const DOCUMENT_CONTENT_RECORD_PLAINTEXT_HASH_KEY_INFO_DOMAIN =
  "tearleads.document.content-record-plaintext-hash-key-info";
export const DOCUMENT_CONTENT_RECORD_AAD_DOMAIN =
  "tearleads.document.content-record-aad";
export const DOCUMENT_CONTENT_RECORD_HKDF_SALT: Uint8Array<ArrayBuffer> =
  new TextEncoder().encode("tearleads.document.content-record-hkdf-salt");
export const DOCUMENT_ENCRYPTED_UPDATE_KEYS = new Set([
  "ciphertext",
  "contentKeyEpoch",
  "contentRecordId",
  "encryptionSuite",
  "format",
  "iv",
  "metadataHash",
  "nonceDomainHash",
  "version",
]);
export const TEXT_ENCODER = new TextEncoder();
interface ProjectionVerificationBase {
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

export type ProjectionVerificationOptions = ProjectionVerificationBase &
  (
    | {
        readonly execSql: ExecSql;
        readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
        readonly trustedLocalProjection?: undefined;
      }
    | {
        readonly execSql?: ExecSql | undefined;
        readonly resolveProjectionUserKey?: undefined;
        readonly trustedLocalProjection: true;
      }
  );

export function resolveProjectionVerifier(
  input: ProjectionVerificationOptions,
  label: string,
): ProjectionUserKeyResolver | null {
  if (input.resolveProjectionUserKey) {
    if (input.trustedLocalProjection === true) {
      throw new Error(
        `${label} cannot combine projection key verification with local projection trust`,
      );
    }
    return requireProjectionUserKeyResolver(
      input.resolveProjectionUserKey,
      label,
    );
  }
  if (input.trustedLocalProjection === true) {
    return null;
  }
  throw new Error(
    `${label} requires projection key verification or an explicitly trusted local projection`,
  );
}

export function projectionVerificationOptions(
  input: ProjectionVerificationOptions,
): ProjectionVerificationOptions {
  const warm = input.warmReferencedPrincipalPolicies;
  const shared = {
    ...(input.stillCurrent ? { stillCurrent: input.stillCurrent } : {}),
    ...(warm ? { warmReferencedPrincipalPolicies: warm } : {}),
  };
  if (input.resolveProjectionUserKey) {
    if (input.trustedLocalProjection === true) {
      throw new Error(
        "Projection use cannot combine key verification with local projection trust",
      );
    }
    return {
      execSql: input.execSql,
      ...shared,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
    };
  }
  if (input.trustedLocalProjection === true) {
    return input.execSql
      ? {
          execSql: input.execSql,
          ...shared,
          trustedLocalProjection: true,
        }
      : { ...shared, trustedLocalProjection: true };
  }

  throw new Error(
    "Projection use requires key verification or an explicitly trusted local projection",
  );
}

export type DocumentCreateAuthor = ContainerMutationAuthor;

export interface BuildDocumentCreatePlanInput {
  author: DocumentCreateAuthor;
  containerProjection: ContainerWriterProjectionResponse;
  contentKeyEpoch?: number;
  documentId?: string;
  eventId?: string;
  signedAt?: string;
  targetEnvelopes: readonly DocumentContentKeyTargetEnvelope[];
}

export interface DocumentCreatePlan {
  body: DocumentLinkAccessEventBody;
  documentId: string;
  event: AccessEvent;
  eventHash: string;
  manifest: AccessManifest;
  manifestHash: string;
  request: DocumentCreateRequest;
  state: DocumentLinkSetManifestState;
  targetHash: string;
  targets: DocumentContentKeyTarget[];
}

export interface MaterializedDocumentCreatePlan {
  contentKey: Uint8Array;
  plan: DocumentCreatePlan;
}

export interface DocumentCreateApi {
  createDocument(
    input: DocumentCreateRequest,
    options?: DocumentSyncRequestResultOptions,
  ): Promise<DocumentCreateResponse | null>;
  // Lets idempotent create inspect an expected already-exists conflict.
  createDocumentResult?(
    input: DocumentCreateRequest,
    options?: DocumentSyncRequestResultOptions | undefined,
  ): Promise<
    | {
        readonly data: DocumentCreateResponse;
        readonly ok: true;
      }
    | DocumentSyncSubmitFailure
  >;
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  // Result-returning variant used by the create path so a terminal projection
  // fetch failure (e.g. a 402 billing block or a 403 after access revocation)
  // can be persisted to the write queue instead of collapsing to a silent
  // null. Optional so simple test doubles need only implement
  // `getContainerWriterProjection`.
  getContainerWriterProjectionResult?(
    containerId: string,
    options?: DocumentSyncRequestResultOptions | undefined,
  ): Promise<
    | {
        readonly data: ContainerWriterProjectionResponse;
        readonly ok: true;
      }
    | DocumentSyncSubmitFailure
  >;
  // Needed to adopt an existing remote document on a create conflict: the
  // committed manifest, content-key bundle and KEK targets are refetched here
  // (the create response that carried them was lost). Optional for the same
  // reason as `createDocumentResult`.
  getDocumentWriterProjection?(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  clearWriterProjectionCaches?(): void;
  evictContainerWriterProjection?(containerId: string): void;
  primeDocumentWriterProjection(
    documentId: string,
    projection: DocumentWriterProjectionResponse,
  ): void;
}

export interface CreateRemoteDocumentResult {
  contentKey: Uint8Array;
  documentId: string;
  persistedState: PersistedDocumentCreateState;
  // `plan` and `response` are absent when the result was adopted from an
  // existing remote document on a create conflict: there is no fresh create
  // response, and the local plan does not match the committed manifest (the
  // first attempt used a different content key). Consumers read only
  // documentId/writerProjection/persistedState.
  plan?: DocumentCreatePlan | undefined;
  response?: DocumentCreateResponse | undefined;
  writerProjection: DocumentWriterProjectionResponse;
}

export type DocumentLinkSetMutationOperation = "link" | "unlink";
export type DocumentLinkSetMutationBody =
  | DocumentLinkAccessEventBody
  | DocumentUnlinkAccessEventBody;

export interface DocumentLinkSetTargetState {
  readonly currentTargets: readonly DocumentContentKeyTarget[];
  readonly linkedContainerIds: readonly string[];
  readonly target: DocumentContentKeyTarget;
  readonly targets: readonly DocumentContentKeyTarget[];
}

export interface BuildDocumentLinkSetMutationPlanInput {
  author: DocumentCreateAuthor;
  contentKeyEpoch: number;
  eventId?: string | undefined;
  operation: DocumentLinkSetMutationOperation;
  signedAt?: string | undefined;
  targetContainerProjection: ContainerWriterProjectionResponse;
  targetEnvelopes: readonly DocumentContentKeyTargetEnvelope[];
  writerProjection: DocumentWriterProjectionResponse;
}

export interface DocumentLinkSetMutationPlan {
  body: DocumentLinkSetMutationBody;
  contentKeyEpoch: number;
  documentId: string;
  event: AccessEvent;
  eventHash: string;
  manifest: AccessManifest;
  manifestHash: string;
  operation: DocumentLinkSetMutationOperation;
  request: DocumentLinkSetMutationRequest;
  state: DocumentLinkSetManifestState;
  targetHash: string;
  targets: DocumentContentKeyTarget[];
}

export interface MaterializedDocumentLinkSetMutationPlan {
  contentKey: Uint8Array;
  contentKeyRotated: boolean;
  plan: DocumentLinkSetMutationPlan;
}

export interface DocumentLinkSetEventPlan {
  authorizingContainerPathRefs: ContainerManifestRef[][];
  body: DocumentLinkSetMutationBody;
  event: AccessEvent;
  eventHash: string;
}

/**
 * What a failed link-set mutation could tell the caller: the HTTP status (or
 * null for network/local failures) and a short message. Threaded up to the
 * move-intent queue so a permission failure reads as one, instead of the
 * generic "rejected or unavailable".
 */
export interface DocumentLinkSetMutationFailure {
  readonly message: string;
  readonly status: number | null;
}

export type DocumentLinkSetFailureHandler = (
  failure: DocumentLinkSetMutationFailure,
) => void;

type DocumentLinkSetMutationResult =
  | { readonly data: DocumentLinkSetMutationResponse; readonly ok: true }
  | {
      readonly message: string;
      readonly ok: false;
      readonly status: number | null;
    };

export interface DocumentLinkSetMutationApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  getContainerWriterProjectionResult?(
    containerId: string,
    options?: DocumentSyncRequestResultOptions | undefined,
  ): Promise<
    | {
        readonly data: ContainerWriterProjectionResponse;
        readonly ok: true;
      }
    | DocumentSyncSubmitFailure
  >;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  getDocumentWriterProjectionResult?(
    documentId: string,
    options?: DocumentSyncRequestResultOptions | undefined,
  ): Promise<
    | {
        readonly data: DocumentWriterProjectionResponse;
        readonly ok: true;
      }
    | DocumentSyncSubmitFailure
  >;
  primeDocumentWriterProjection(
    documentId: string,
    projection: DocumentWriterProjectionResponse,
  ): void;
  linkDocument(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
    options?: DocumentSyncRequestResultOptions,
  ): Promise<DocumentLinkSetMutationResponse | null>;
  linkDocumentResult?(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
    options?: DocumentSyncRequestResultOptions,
  ): Promise<DocumentLinkSetMutationResult>;
  unlinkDocument(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
    options?: DocumentSyncRequestResultOptions,
  ): Promise<DocumentLinkSetMutationResponse | null>;
  unlinkDocumentResult?(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
    options?: DocumentSyncRequestResultOptions,
  ): Promise<DocumentLinkSetMutationResult>;
}

export interface RelinkRemoteDocumentResult {
  contentKey: Uint8Array;
  contentKeyRotated: boolean;
  documentId: string;
  linkedContainerIds: readonly string[];
  persistedState: PersistedDocumentCreateState;
  plan: DocumentLinkSetMutationPlan;
  response: DocumentLinkSetMutationResponse;
}

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
  contentKeyBundle: DocumentCreateResponse["contentKeyBundle"];
  documentId?: string | undefined;
  documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  documentManifest: DocumentCreateResponse["accessManifest"];
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
  documentManifest: DocumentCreateResponse["accessManifest"];
  documentWriterAuthorization?: WriterAuthorization | undefined;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  minLsn?: string | undefined;
  organizationId: string;
  request: DocumentSyncRequest;
  sourceContentKeyBundle: DocumentCreateResponse["contentKeyBundle"];
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

export interface DocumentSyncRequestResultOptions {
  readonly expectedPaymentRequiredOrganizationId?: string | undefined;
  readonly reportErrors?: boolean | undefined;
}

export interface DocumentSyncApi {
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
  getDocumentWriterProjectionResult?(
    documentId: string,
    options?: DocumentSyncRequestResultOptions | undefined,
  ): Promise<
    | {
        readonly data: DocumentWriterProjectionResponse;
        readonly ok: true;
      }
    | DocumentSyncSubmitFailure
  >;
  syncDocument(
    documentId: string,
    input: DocumentSyncRequest,
    options?: DocumentSyncRequestResultOptions,
  ): Promise<DocumentSyncResponse | null>;
  syncDocumentResult?(
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

export type DocumentWriterPublicKeyResolver = (input: {
  writerSigningKeyFingerprint: string;
  writerUserId: string;
}) => Promise<Uint8Array | null>;

export type PersistedDocumentCreateState = Pick<
  DocumentRecord,
  | "documentId"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle"
>;

export type PersistedDocumentSyncState = PersistedDocumentCreateState;

export interface UnwrappedContainerKek {
  containerId: string;
  /**
   * Null for keyring-recovered historical keys, which carry key material and
   * the epoch id committing to it but no epoch record to hash.
   *
   * Such a key still satisfies a parent wrap: the epoch-record fingerprint is
   * a selector for choosing among envelopes, not the security boundary, so a
   * null hash falls back to selecting on the epoch id while AEAD authenticates
   * (see `containerKekPath.ts`). That is what lets a descendant pinned to a
   * rotated parent be opened rather than stranded.
   */
  keyEpochHash: string | null;
  keyMaterial: Uint8Array;
}
