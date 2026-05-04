import type {
  BlobAttachmentBindRequest,
  BlobContentKeyBundleRequest,
  StageBlobRequest,
} from "@tearleads/validators/request";
import type {
  BlobAttachmentBindResponse,
  DocumentWriterProjectionResponse,
  StageBlobResponse,
} from "@tearleads/validators/response";
import type { BlobBytes } from "../../../blobs";
import type { ProjectionUserKeyResolver } from "../../../keyingProjectionVerification";
import type { ExecSql } from "../../../persistence/sqlSchema";
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
  "contentKeyBundle",
  "contentKeyEpoch",
  "contentRecordId",
  "encryptionSuite",
  "format",
  "iv",
  "metadataHash",
  "nonceDomainHash",
  "targetHash",
  "version",
]);
export const TEXT_ENCODER = new TextEncoder();

export interface BlobAttachmentApi {
  bindBlobAttachment(
    blobId: string,
    input: BlobAttachmentBindRequest,
  ): Promise<BlobAttachmentBindResponse | null>;
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  stageBlob(input: StageBlobRequest): Promise<StageBlobResponse | null>;
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
  contentKeyBundle: BlobContentKeyBundleRequest;
  contentKeyEpoch: number;
  contentRecordId: string;
  iv: Uint8Array;
  metadataHash: string;
  nonceDomainHash: string;
  targetHash: string;
}

export interface BlobEncryptedBytes {
  encryptedBytes: string;
  metadataHash: string;
  sha256: string;
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
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  signedAt?: string | undefined;
  slotId: string;
  targetSecretKey: Uint8Array;
}

export interface UploadDocumentAttachmentResult {
  blobId: string;
  bindingId: string;
  encryptedBytes: string;
  request: BlobAttachmentBindRequest;
  response: BlobAttachmentBindResponse;
  sha256: string;
  writeHeader: import("@tearleads/crypto").WriteHeader;
  writeHeaderHash: string;
}

export interface DecryptDocumentAttachmentBlobInput {
  encryptedBytes: string;
  expectedBindingId: string;
  expectedBlobId: string;
  execSql?: ExecSql | undefined;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  targetSecretKey: Uint8Array;
  writerProjection: DocumentWriterProjectionResponse;
}
