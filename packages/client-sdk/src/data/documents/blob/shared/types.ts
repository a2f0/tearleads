import type { UploadMultipartBlobPartBytesRequest } from "@tearleads/api-client";
import type { BlobContentKeyTarget, WriteHeader } from "@tearleads/crypto";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  BlobContentKeyBundleRequest,
  CompleteMultipartBlobStageRequest,
  InitiateMultipartBlobStageRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
  BlobAttachmentSummary,
  CompleteMultipartBlobStageResponse,
  DocumentWriterProjectionResponse,
  InitiateMultipartBlobStageResponse,
  MultipartBlobStageStatusResponse,
  UploadMultipartBlobPartResponse,
} from "@tearleads/validators/response";
import type { BlobByteSourceInput, BlobBytes } from "../../../blobContracts";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../keyingProjectionVerification";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import type { DocumentCreateAuthor } from "../../shared/types";

export const BLOB_ENCRYPTED_BYTES_FORMAT = "tearleads.blob.bytes";
export const BLOB_ENCRYPTED_BYTES_VERSION = 2;
export const BLOB_ENCRYPTED_BYTES_MAGIC = "tearleads.blob.bytes.v2";
export const BLOB_CONTENT_RECORD_KEY_INFO_DOMAIN =
  "tearleads.blob.content-record-key-info";
export const BLOB_CONTENT_RECORD_AAD_DOMAIN =
  "tearleads.blob.content-record-aad";
export const BLOB_CONTENT_RECORD_METADATA_HASH_DOMAIN =
  "tearleads.blob.content-record-metadata";
export const BLOB_CONTENT_RECORD_NONCE_DOMAIN =
  "tearleads.blob.content-record-nonce";
export const BLOB_CONTENT_RECORD_HKDF_SALT: Uint8Array<ArrayBuffer> =
  new TextEncoder().encode("tearleads.blob.content-record-hkdf-salt");
export const BLOB_ENCRYPTED_BYTES_KEYS = new Set([
  "blobId",
  "byteLength",
  "chunkCount",
  "chunkSize",
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

export interface BlobAttachmentApi {
  bindBlobAttachment(
    blobId: string,
    input: BlobAttachmentBindRequest,
  ): Promise<BlobAttachmentBindResponse | null>;
  clearWriterProjectionCaches?(): void;
  evictDocumentWriterProjection?(documentId: string): void;
  getRequestFailure?(input: {
    method: "DELETE" | "GET" | "POST" | "PUT";
    path: string;
  }): {
    readonly code?: string | undefined;
    readonly kind: "http" | "json" | "network" | "shape";
    readonly message: string;
    readonly status: number | null;
  } | null;
  completeMultipartBlobStage(
    stageId: string,
    input: CompleteMultipartBlobStageRequest,
  ): Promise<CompleteMultipartBlobStageResponse | null>;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  getMultipartBlobStage(
    stageId: string,
  ): Promise<MultipartBlobStageStatusResponse | null>;
  initiateMultipartBlobStage(
    input: InitiateMultipartBlobStageRequest,
  ): Promise<InitiateMultipartBlobStageResponse | null>;
  uploadMultipartBlobPartBytes(
    stageId: string,
    partNumber: number,
    input: UploadMultipartBlobPartBytesRequest,
  ): Promise<UploadMultipartBlobPartResponse | null>;
}

export interface BlobAttachmentDetachApi {
  detachBlobAttachment(
    blobId: string,
    bindingId: string,
    input: BlobAttachmentDetachRequest,
  ): Promise<BlobAttachmentDetachResponse | null>;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
}

export type { BlobContentKeyTarget };

export interface BlobEncryptedBytesRecord {
  blobId: string;
  byteLength: number;
  chunkCount: number;
  chunks: BlobEncryptedChunk[];
  chunkSize: number;
  contentKeyEpoch: number;
  contentRecordId: string;
  encryptedByteLength: number;
  headerByteLength: number;
  iv: Uint8Array;
  metadataHash: string;
  nonceDomainHash: string;
}

export interface BlobEncryptedChunk {
  ciphertext: BlobBytes;
  index: number;
  plaintextByteLength: number;
}

export interface BlobSourceSnapshot {
  readonly byteLength: number;
  readonly chunkSha256: readonly string[];
  readonly chunkSize: number;
  readonly sha256: string;
}

export interface BlobEncryptionPlan {
  readonly byteLength: number;
  readonly chunkSize: number;
  readonly metadataHash: string;
  readonly partCount: number;
  readonly plaintextByteLength: number;
  readonly plaintextSha256: string;
  readonly sha256: string;
  encryptPart(index: number): Promise<BlobBytes>;
  getPartByteLength(index: number): number;
}

export interface DocumentManifestIdentity {
  documentId: string;
  manifestHash: string;
  organizationId: string;
}

export interface BlobAttachmentMaterial {
  blobAccessManifestHash: string;
  contentKeyBundle: BlobContentKeyBundleRequest;
  encrypted: BlobEncryptionPlan;
  manifestIdentity: DocumentManifestIdentity;
  targetHash: string;
  targets: BlobContentKeyTarget[];
  writerProjection: DocumentWriterProjectionResponse;
}

/**
 * Progress for an in-flight multipart blob upload.
 */
export interface MultipartUploadProgress {
  readonly bytesTotal: number;
  readonly bytesUploaded: number;
  readonly partsCompleted: number;
  readonly partsTotal: number;
}

export type MultipartUploadProgressListener = (
  progress: MultipartUploadProgress,
) => void;

/**
 * Fires once a multipart stage has been opened (or resumed), with its id and
 * plaintext chunk size. Callers persist both so a later attempt can reproduce
 * the same encrypted parts and resume instead of orphaning the partial upload.
 */
export type MultipartStageResolvedListener = (input: {
  readonly partSize: number;
  readonly stageId: string;
}) => void | Promise<void>;

export interface UploadDocumentAttachmentInput {
  apiClient: BlobAttachmentApi;
  author: DocumentCreateAuthor;
  blobId?: string | undefined;
  bindingId?: string | undefined;
  bytes: BlobByteSourceInput;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId: string;
  eventId?: string | undefined;
  execSql: ExecSql;
  expectedBindingId: string | null;
  isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
  // A persisted nonce seed. The plaintext digest derives the envelope IV from
  // it, then each chunk derives a unique IV. Same-source retries reproduce the
  // encrypted parts; changed bytes cannot reuse their AES-GCM nonces.
  nonceSeed?: Uint8Array | undefined;
  multipart?: MultipartBlobUploadOptions | undefined;
  onMultipartProgress?: MultipartUploadProgressListener | undefined;
  onStageResolved?: MultipartStageResolvedListener | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  slotId: string;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

export interface MultipartBlobUploadOptions {
  /** Exactly 5 MiB of plaintext per independently encrypted multipart chunk. */
  readonly partSize: number;
  // The id of a previously opened stage to resume. When set, the upload refetches
  // that stage and skips parts the server already has instead of opening a new
  // one; if the stage is gone (expired), it falls back to a fresh stage.
  readonly resumeStageId?: string | undefined;
  readonly uploadConcurrency?: number | undefined;
}

export interface UploadDocumentAttachmentResult {
  blobId: string;
  bindingId: string;
  request: BlobAttachmentBindRequest;
  response: BlobAttachmentBindResponse;
  sha256: string;
  byteLength: number;
  writeHeader: WriteHeader;
  writeHeaderHash: string;
  writerProjection: DocumentWriterProjectionResponse;
}

export interface DetachDocumentAttachmentInput {
  apiClient: BlobAttachmentDetachApi;
  author: DocumentCreateAuthor;
  bindingId: string;
  blobId: string;
  documentId: string;
  eventId?: string | undefined;
  execSql: ExecSql;
  isRemoteSyncBlocked?: ((organizationId: string) => boolean) | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  slotId: string;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

export interface DetachDocumentAttachmentResult {
  request: BlobAttachmentDetachRequest;
  response: BlobAttachmentDetachResponse;
  writerProjection: DocumentWriterProjectionResponse;
}

export interface DecryptDocumentAttachmentBlobInput {
  binding: BlobAttachmentSummary;
  encryptedBytes: BlobBytes;
  expectedDocumentId: string;
  expectedSlotId: string;
  execSql: ExecSql;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  targetSecretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
}
