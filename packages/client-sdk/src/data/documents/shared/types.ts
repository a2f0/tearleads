import type { BlobBytesResponse } from "@tearleads/api-client";
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
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
  ListDocumentAttachmentsResponse,
} from "@tearleads/validators/response";
import type { ContainerMutationAuthor } from "../../containers/shared/types";
import type { DocumentRecord } from "../../persistence/documents/records";
import type { DocumentSyncSubmitFailure } from "./sync/syncSubmitFailure";

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
  // Lets idempotent create inspect an expected already-exists conflict.
  createDocumentResult(
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
  // null.
  getContainerWriterProjectionResult(
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
  // (the create response that carried them was lost).
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  evictContainerWriterProjection(containerId: string): void;
  primeDocumentWriterProjection(
    documentId: string,
    projection: DocumentWriterProjectionResponse,
  ): void;
}

export interface CreateRemoteDocumentResult {
  contentKey: Uint8Array;
  /** The requested `deferredSeedUpdate`, signed but unsent, for a bind. */
  deferredSeed?: DocumentSyncRequest | undefined;
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
  blobRewraps: DocumentLinkAccessEventBody["blobRewraps"];
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
export type DocumentLinkSetMutationFailure = Pick<
  DocumentSyncSubmitFailure,
  "code" | "message" | "status"
>;

export type DocumentLinkSetFailureHandler = (
  failure: DocumentLinkSetMutationFailure,
) => void;

/**
 * `prove` pulls and verifies the document's full history. `reuse` returns the
 * store's last completed proof while the same local document still sits at
 * that proof's version vector, and proves otherwise; only a caller the server
 * re-checks (an unlink's rotation baseline) may reuse.
 */
export type DocumentRotationProofMode = "prove" | "reuse";

type DocumentLinkSetMutationResult =
  | { readonly data: DocumentLinkSetMutationResponse; readonly ok: true }
  | (DocumentLinkSetMutationFailure & { readonly ok: false });

export interface DocumentLinkSetMutationApi {
  getBlobBytes(blobId: string): Promise<BlobBytesResponse | null>;
  listDocumentAttachments(
    documentId: string,
  ): Promise<ListDocumentAttachmentsResponse | null>;
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  getContainerWriterProjectionResult(
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
  primeDocumentWriterProjection(
    documentId: string,
    projection: DocumentWriterProjectionResponse,
  ): void;
  linkDocumentResult(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
    options?: DocumentSyncRequestResultOptions,
  ): Promise<DocumentLinkSetMutationResult>;
  unlinkDocumentResult(
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

export interface DocumentSyncRequestResultOptions {
  readonly expectedPaymentRequiredOrganizationId?: string | undefined;
  readonly reportErrors?: boolean | undefined;
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
