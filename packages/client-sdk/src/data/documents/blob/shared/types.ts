import type { UploadMultipartBlobPartBytesRequest } from "@tearleads/api-client";
import type { WriteHeader } from "@tearleads/crypto";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  BlobContentKeyBundleRequest,
  CompleteMultipartBlobStageRequest,
  InitiateMultipartBlobStageRequest,
  StageBlobRequest,
  UploadMultipartBlobPartRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  BlobAttachmentDetachResponse,
  BlobContentKeyBundleResponse,
  BlobUploadCapabilitiesResponse,
  CompleteMultipartBlobStageResponse,
  DocumentWriterProjectionResponse,
  InitiateMultipartBlobStageResponse,
  MultipartBlobStageStatusResponse,
  StageBlobResponse,
  UploadMultipartBlobPartResponse,
} from "@tearleads/validators/response";
import type { BlobBytes } from "../../../blobContracts";
import type { ProjectionUserKeyResolver } from "../../../keyingProjectionVerification";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import type { DocumentCreateAuthor } from "../../shared/types";

export const BLOB_ENCRYPTED_BYTES_FORMAT = "tearleads.blob.bytes";
export const BLOB_CONTENT_RECORD_KEY_INFO_DOMAIN =
  "tearleads.blob.content-record-key-info";
export const BLOB_CONTENT_RECORD_AAD_DOMAIN =
  "tearleads.blob.content-record-aad";
export const BLOB_CONTENT_RECORD_METADATA_HASH_DOMAIN =
  "tearleads.blob.content-record-metadata";
export const BLOB_CONTENT_RECORD_HKDF_SALT: Uint8Array<ArrayBuffer> =
  new TextEncoder().encode("tearleads.blob.content-record-hkdf-salt");
export const BLOB_ENCRYPTED_BYTES_KEYS = new Set([
  "blobId",
  "byteLength",
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

export interface BlobAttachmentApi {
  bindBlobAttachment(
    blobId: string,
    input: BlobAttachmentBindRequest,
  ): Promise<BlobAttachmentBindResponse | null>;
  clearWriterProjectionCaches?(): void;
  completeMultipartBlobStage?(
    stageId: string,
    input: CompleteMultipartBlobStageRequest,
  ): Promise<CompleteMultipartBlobStageResponse | null>;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  getBlobUploadCapabilities?(): Promise<BlobUploadCapabilitiesResponse | null>;
  getMultipartBlobStage?(
    stageId: string,
  ): Promise<MultipartBlobStageStatusResponse | null>;
  initiateMultipartBlobStage?(
    input: InitiateMultipartBlobStageRequest,
  ): Promise<InitiateMultipartBlobStageResponse | null>;
  stageBlob(input: StageBlobRequest): Promise<StageBlobResponse | null>;
  uploadMultipartBlobPart?(
    stageId: string,
    partNumber: number,
    input: UploadMultipartBlobPartRequest,
  ): Promise<UploadMultipartBlobPartResponse | null>;
  uploadMultipartBlobPartBytes?(
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

export interface BlobContentKeyTarget {
  bindingId: string;
  documentId: string;
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
}

export interface BlobEncryptedBytesRecord {
  blobId: string;
  byteLength: number;
  ciphertext: Uint8Array;
  contentKeyEpoch: number;
  contentRecordId: string;
  iv: Uint8Array;
  metadataHash: string;
  nonceDomainHash: string;
}

export interface BlobEncryptedBytes {
  encryptedBytes: string;
  metadataHash: string;
  sha256: string;
  byteLength: number;
}

export interface DocumentManifestIdentity {
  documentId: string;
  manifestHash: string;
  organizationId: string;
}

export interface BlobAttachmentMaterial {
  blobAccessManifestHash: string;
  contentKeyBundle: BlobContentKeyBundleRequest;
  encrypted: BlobEncryptedBytes;
  manifestIdentity: DocumentManifestIdentity;
  targetHash: string;
  targets: BlobContentKeyTarget[];
  writerProjection: DocumentWriterProjectionResponse;
}

/**
 * Progress for an in-flight multipart blob upload. Only emitted when the
 * multipart path is taken (single-shot staging reports nothing).
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

export interface UploadDocumentAttachmentInput {
  apiClient: BlobAttachmentApi;
  author: DocumentCreateAuthor;
  blobId?: string | undefined;
  bindingId?: string | undefined;
  bytes: BlobBytes;
  contentKey?: Uint8Array | undefined;
  contentKeyEpoch?: number | undefined;
  documentId: string;
  eventId?: string | undefined;
  execSql?: ExecSql | undefined;
  expectedBindingId: string | null;
  multipart?: MultipartBlobUploadOptions | undefined;
  onMultipartProgress?: MultipartUploadProgressListener | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  slotId: string;
  targetSecretKey: Uint8Array;
  writerProjection?: DocumentWriterProjectionResponse | undefined;
}

export interface MultipartBlobUploadOptions {
  readonly existingStage?:
    | InitiateMultipartBlobStageResponse
    | MultipartBlobStageStatusResponse
    | undefined;
  readonly partSize: number;
  readonly uploadConcurrency?: number | undefined;
}

export interface UploadDocumentAttachmentResult {
  blobId: string;
  bindingId: string;
  encryptedBytes: string;
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
  execSql?: ExecSql | undefined;
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
  contentKeyBundle: BlobContentKeyBundleResponse;
  encryptedBytes: string;
  expectedBindingId: string;
  expectedBlobId: string;
  execSql?: ExecSql | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  targetSecretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
}
