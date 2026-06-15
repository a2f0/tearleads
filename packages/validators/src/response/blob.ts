import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasBooleanProperty,
  hasObjectProperty,
  hasPositiveIntegerProperty,
  hasStringProperty,
  isRecordArray,
  isStringArray,
} from "../util";

export interface StageBlobResponse {
  stageId: string;
  expiresAt: string;
}

export interface BlobUploadCapabilitiesResponse {
  multipart: {
    durable: boolean;
    enabled: boolean;
  };
}

export interface MultipartBlobStagePart {
  byteLength: number;
  etag: string;
  partNumber: number;
}

export interface InitiateMultipartBlobStageResponse {
  byteLength: number;
  expiresAt: string;
  sha256: string;
  stageId: string;
  uploadId: string;
  uploadedParts: MultipartBlobStagePart[];
}

export interface MultipartBlobStageStatusResponse
  extends InitiateMultipartBlobStageResponse {
  completed: boolean;
}

export interface UploadMultipartBlobPartResponse {
  part: MultipartBlobStagePart;
  stageId: string;
  uploadId: string;
}

export interface CompleteMultipartBlobStageResponse {
  byteLength: number;
  expiresAt: string;
  sha256: string;
  stageId: string;
}

export interface BlobAttachmentSummary {
  bindingId: string;
  blobId: string;
  contentKeyBundle: BlobContentKeyBundleResponse;
  slotId: string;
}

export type ListDocumentAttachmentsResponse = BlobAttachmentSummary[];

export interface BlobResponse {
  blobId: string;
  encryptedBytes: string;
  sha256: string;
}

export interface BlobKekTargetsResponse {
  blobId: string;
  organizationId: string;
  activeBindingIds: string[];
  documentManifestHashes: string[];
  linkedContainerManifestHashes: string[];
  linkedContainerKeyEpochIds: string[];
  targets: Record<string, unknown>[];
  blobKeyTargetHash: string;
  blobAccessManifestHash: string;
}

export interface BlobContentKeyTargetEnvelopeResponse {
  bindingId: string;
  documentId: string;
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
  wrappedKey: string;
  wrappingMetadata: Record<string, unknown>;
}

export interface BlobContentKeyBundleResponse {
  blobId: string;
  contentKeyEpoch: number;
  targetHash: string;
  targets: BlobContentKeyTargetEnvelopeResponse[];
}

export interface BlobAttachmentBindResponse {
  bindingId: string;
  blobId: string;
  documentId: string;
  slotId: string;
  contentKeyBundle: BlobContentKeyBundleResponse;
  blobKekTargets: BlobKekTargetsResponse;
  writeHeaderHash?: string;
}

export interface BlobAttachmentDetachResponse {
  bindingId: string;
  blobId: string;
  documentId: string;
  slotId: string;
}

export function isStageBlobResponse(
  value: unknown,
): value is StageBlobResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "stageId") &&
    hasStringProperty(value, "expiresAt")
  );
}

export function isBlobUploadCapabilitiesResponse(
  value: unknown,
): value is BlobUploadCapabilitiesResponse {
  const multipart = isPlainObject(value)
    ? Reflect.get(value, "multipart")
    : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(multipart) &&
    hasBooleanProperty(multipart, "enabled") &&
    hasBooleanProperty(multipart, "durable")
  );
}

function isMultipartBlobStagePart(
  value: unknown,
): value is MultipartBlobStagePart {
  return (
    isPlainObject(value) &&
    hasPositiveIntegerProperty(value, "partNumber") &&
    hasPositiveIntegerProperty(value, "byteLength") &&
    hasStringProperty(value, "etag") &&
    value.etag.length > 0
  );
}

export function isInitiateMultipartBlobStageResponse(
  value: unknown,
): value is InitiateMultipartBlobStageResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "stageId") &&
    hasStringProperty(value, "uploadId") &&
    hasStringProperty(value, "expiresAt") &&
    hasPositiveIntegerProperty(value, "byteLength") &&
    hasStringProperty(value, "sha256") &&
    value.sha256.length > 0 &&
    hasArrayProperty(value, "uploadedParts") &&
    value.uploadedParts.every(isMultipartBlobStagePart)
  );
}

export function isMultipartBlobStageStatusResponse(
  value: unknown,
): value is MultipartBlobStageStatusResponse {
  return (
    isInitiateMultipartBlobStageResponse(value) &&
    typeof Reflect.get(value, "completed") === "boolean"
  );
}

export function isUploadMultipartBlobPartResponse(
  value: unknown,
): value is UploadMultipartBlobPartResponse {
  const part = isPlainObject(value) ? Reflect.get(value, "part") : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "stageId") &&
    hasStringProperty(value, "uploadId") &&
    isMultipartBlobStagePart(part)
  );
}

export function isCompleteMultipartBlobStageResponse(
  value: unknown,
): value is CompleteMultipartBlobStageResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "stageId") &&
    hasStringProperty(value, "expiresAt") &&
    hasPositiveIntegerProperty(value, "byteLength") &&
    hasStringProperty(value, "sha256") &&
    value.sha256.length > 0
  );
}

function isBlobAttachmentSummary(
  value: unknown,
): value is BlobAttachmentSummary {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "bindingId") &&
    hasStringProperty(value, "blobId") &&
    hasObjectProperty(value, "contentKeyBundle") &&
    isBlobContentKeyBundleResponse(value.contentKeyBundle) &&
    hasStringProperty(value, "slotId")
  );
}

export function isListDocumentAttachmentsResponse(
  value: unknown,
): value is ListDocumentAttachmentsResponse {
  return (
    Array.isArray(value) &&
    value.every((entry) => isBlobAttachmentSummary(entry))
  );
}

export function isBlobResponse(value: unknown): value is BlobResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "blobId") &&
    hasStringProperty(value, "encryptedBytes") &&
    hasStringProperty(value, "sha256")
  );
}

function isBlobKekTargetsResponse(
  value: unknown,
): value is BlobKekTargetsResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "blobId") &&
    hasStringProperty(value, "organizationId") &&
    hasArrayProperty(value, "activeBindingIds") &&
    isStringArray(value.activeBindingIds) &&
    hasArrayProperty(value, "documentManifestHashes") &&
    isStringArray(value.documentManifestHashes) &&
    hasArrayProperty(value, "linkedContainerManifestHashes") &&
    isStringArray(value.linkedContainerManifestHashes) &&
    hasArrayProperty(value, "linkedContainerKeyEpochIds") &&
    isStringArray(value.linkedContainerKeyEpochIds) &&
    hasArrayProperty(value, "targets") &&
    isRecordArray(value.targets) &&
    hasStringProperty(value, "blobKeyTargetHash") &&
    hasStringProperty(value, "blobAccessManifestHash")
  );
}

function isBlobContentKeyTargetEnvelopeResponse(
  value: unknown,
): value is BlobContentKeyTargetEnvelopeResponse {
  const wrappingMetadata = isPlainObject(value)
    ? Reflect.get(value, "wrappingMetadata")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "bindingId") &&
    hasStringProperty(value, "documentId") &&
    hasStringProperty(value, "containerId") &&
    hasStringProperty(value, "containerManifestHash") &&
    hasStringProperty(value, "containerKeyEpochId") &&
    hasPositiveIntegerProperty(value, "containerKeyEpoch") &&
    hasStringProperty(value, "wrappedKey") &&
    isPlainObject(wrappingMetadata)
  );
}

function isBlobContentKeyBundleResponse(
  value: unknown,
): value is BlobContentKeyBundleResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "blobId") &&
    hasPositiveIntegerProperty(value, "contentKeyEpoch") &&
    hasStringProperty(value, "targetHash") &&
    hasArrayProperty(value, "targets") &&
    value.targets.every(isBlobContentKeyTargetEnvelopeResponse)
  );
}

export function isBlobAttachmentBindResponse(
  value: unknown,
): value is BlobAttachmentBindResponse {
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;
  const blobKekTargets = isPlainObject(value)
    ? Reflect.get(value, "blobKekTargets")
    : undefined;
  const writeHeaderHash = isPlainObject(value)
    ? Reflect.get(value, "writeHeaderHash")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "bindingId") &&
    hasStringProperty(value, "blobId") &&
    hasStringProperty(value, "documentId") &&
    hasStringProperty(value, "slotId") &&
    isBlobContentKeyBundleResponse(contentKeyBundle) &&
    isBlobKekTargetsResponse(blobKekTargets) &&
    (writeHeaderHash === undefined ||
      hasStringProperty(value, "writeHeaderHash"))
  );
}

export function isBlobAttachmentDetachResponse(
  value: unknown,
): value is BlobAttachmentDetachResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "bindingId") &&
    hasStringProperty(value, "blobId") &&
    hasStringProperty(value, "documentId") &&
    hasStringProperty(value, "slotId")
  );
}
