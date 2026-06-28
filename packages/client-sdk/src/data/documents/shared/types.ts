import type {
  AccessEvent,
  AccessManifest,
  DocumentContentKeyTarget,
  DocumentLinkAccessEventBody,
  DocumentLinkSetManifestState,
  DocumentUnlinkAccessEventBody,
  WriteHeader,
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
  DocumentSyncResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import type { ProjectionUserKeyResolver } from "../../keyingProjectionVerification";
import { requireProjectionUserKeyResolver } from "../../keyingProjectionVerification";
import type { DocumentRecord } from "../../sqlite/documentPersistence";

export const DOCUMENT_ENCRYPTED_LORO_UPDATE_FORMAT =
  "tearleads.document.loro-update";
export const DOCUMENT_CONTENT_RECORD_KEY_INFO_DOMAIN =
  "tearleads.document.content-record-key-info";
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

export type ProjectionVerificationOptions =
  | {
      readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
      readonly trustedLocalProjection?: boolean | undefined;
    }
  | {
      readonly resolveProjectionUserKey?: ProjectionUserKeyResolver | undefined;
      readonly trustedLocalProjection: true;
    };

export function resolveProjectionVerifier(
  input: ProjectionVerificationOptions,
  label: string,
): ProjectionUserKeyResolver | null {
  if (input.resolveProjectionUserKey) {
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
  if (input.resolveProjectionUserKey) {
    return { resolveProjectionUserKey: input.resolveProjectionUserKey };
  }
  if (input.trustedLocalProjection === true) {
    return { trustedLocalProjection: true };
  }

  throw new Error(
    "Projection use requires key verification or an explicitly trusted local projection",
  );
}

export interface DocumentCreateAuthor {
  organizationId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}

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
  ): Promise<DocumentCreateResponse | null>;
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  clearWriterProjectionCaches?(): void;
  primeDocumentWriterProjection(
    documentId: string,
    projection: DocumentWriterProjectionResponse,
  ): void;
}

export interface CreateRemoteDocumentResult {
  contentKey: Uint8Array;
  documentId: string;
  persistedState: PersistedDocumentCreateState;
  plan: DocumentCreatePlan;
  response: DocumentCreateResponse;
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

export interface DocumentLinkSetMutationApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  primeDocumentWriterProjection(
    documentId: string,
    projection: DocumentWriterProjectionResponse,
  ): void;
  linkDocument(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
  ): Promise<DocumentLinkSetMutationResponse | null>;
  unlinkDocument(
    documentId: string,
    input: DocumentLinkSetMutationRequest,
  ): Promise<DocumentLinkSetMutationResponse | null>;
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
  ciphertextHash: string;
  contentRecordId?: string | undefined;
  encryptedData: string;
  id: string;
  metadataHash: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  signedAt?: string | undefined;
  sourceVersionVector?: string | undefined;
}

export interface DocumentEncryptedPendingUpdate {
  contentRecordId: string;
  encryptedData: string;
  metadataHash: string;
  ciphertextHash: string;
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
  id: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  updateData: Uint8Array;
}

export interface BuildDocumentSyncPlanInput {
  author: DocumentCreateAuthor;
  authorizingContainerPathRefs?: readonly (readonly ContainerManifestRef[])[];
  contentKeyBundle: DocumentCreateResponse["contentKeyBundle"];
  documentId?: string | undefined;
  documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  documentManifest: DocumentCreateResponse["accessManifest"];
  localVersionVector: string | null;
  minLsn?: string | undefined;
  outgoingUpdates?: readonly DocumentSyncPreparedUpdate[] | undefined;
  signedAt?: string | undefined;
}

export interface DocumentSyncPlan {
  contentKeyEpoch: number;
  documentId: string;
  documentKekTargets: DocumentSyncResponse["documentKekTargets"];
  documentManifest: DocumentCreateResponse["accessManifest"];
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  minLsn?: string | undefined;
  organizationId: string;
  request: DocumentSyncRequest;
  sourceContentKeyBundle: DocumentCreateResponse["contentKeyBundle"];
}

export interface MaterializedDocumentSyncPlan {
  contentKey: Uint8Array;
  plan: DocumentSyncPlan;
}

export interface SyncRemoteDocumentResult {
  contentKey: Uint8Array;
  decryptedUpdates: DecryptedDocumentSyncUpdate[];
  persistedState: PersistedDocumentSyncState;
  plan: DocumentSyncPlan;
  response: DocumentSyncResponse;
  settledPendingUpdateIds: readonly string[];
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

export interface DocumentSyncSubmitFailure {
  readonly message: string;
  readonly ok: false;
  readonly report: () => void;
  readonly status: number | null;
}

export interface DocumentSyncRequestResultOptions {
  readonly reportErrors?: boolean | undefined;
}

export interface DocumentSyncApi {
  clearWriterProjectionCaches?(): void;
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
  ): Promise<DocumentSyncResponse | null>;
  syncDocumentResult?(
    documentId: string,
    input: DocumentSyncRequest,
    options?: { readonly reportErrors?: boolean | undefined },
  ): Promise<
    | {
        readonly data: DocumentSyncResponse;
        readonly ok: true;
      }
    | DocumentSyncSubmitFailure
  >;
}

export type DocumentWriterPublicKeyResolver = (input: {
  authorFingerprint: string;
  header: WriteHeader;
  update: DocumentSyncResponse["updates"][number];
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
  keyEpochHash: string;
  keyMaterial: Uint8Array;
}
