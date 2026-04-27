import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";

export interface StageBlobResponse {
  stageId: string;
  expiresAt: string;
}

export interface BlobAttachmentSummary {
  bindingId: string;
  blobId: string;
  slotId: string;
}

export type ListDocumentAttachmentsResponse = BlobAttachmentSummary[];

export interface BlobResponse {
  blobId: string;
  encryptedBytes: string;
  sha256: string;
}

export interface BlobV2KekTargetsResponse {
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

export interface BlobV2ContentKeyTargetEnvelopeResponse {
  bindingId: string;
  documentId: string;
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
  wrappedKey: string;
  wrappingMetadata: Record<string, unknown>;
}

export interface BlobV2ContentKeyBundleResponse {
  blobId: string;
  contentKeyEpoch: number;
  targetHash: string;
  targets: BlobV2ContentKeyTargetEnvelopeResponse[];
}

export interface BlobV2AttachmentBindResponse {
  bindingId: string;
  blobId: string;
  documentId: string;
  slotId: string;
  contentKeyBundle: BlobV2ContentKeyBundleResponse;
  blobKekTargets: BlobV2KekTargetsResponse;
  writeHeaderHash?: string;
}

export interface BlobV2AttachmentDetachResponse {
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

function isBlobAttachmentSummary(
  value: unknown,
): value is BlobAttachmentSummary {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "bindingId") &&
    hasStringProperty(value, "blobId") &&
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

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

function hasPositiveNumberProperty<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): value is Record<string, unknown> & Record<Key, number> {
  return (
    hasNumberProperty(value, key) &&
    Number.isInteger(value[key]) &&
    value[key] > 0
  );
}

function isBlobV2KekTargetsResponse(
  value: unknown,
): value is BlobV2KekTargetsResponse {
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

function isBlobV2ContentKeyTargetEnvelopeResponse(
  value: unknown,
): value is BlobV2ContentKeyTargetEnvelopeResponse {
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
    hasPositiveNumberProperty(value, "containerKeyEpoch") &&
    hasStringProperty(value, "wrappedKey") &&
    isPlainObject(wrappingMetadata)
  );
}

function isBlobV2ContentKeyBundleResponse(
  value: unknown,
): value is BlobV2ContentKeyBundleResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "blobId") &&
    hasPositiveNumberProperty(value, "contentKeyEpoch") &&
    hasStringProperty(value, "targetHash") &&
    hasArrayProperty(value, "targets") &&
    value.targets.every(isBlobV2ContentKeyTargetEnvelopeResponse)
  );
}

export function isBlobV2AttachmentBindResponse(
  value: unknown,
): value is BlobV2AttachmentBindResponse {
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
    isBlobV2ContentKeyBundleResponse(contentKeyBundle) &&
    isBlobV2KekTargetsResponse(blobKekTargets) &&
    (writeHeaderHash === undefined ||
      hasStringProperty(value, "writeHeaderHash"))
  );
}

export function isBlobV2AttachmentDetachResponse(
  value: unknown,
): value is BlobV2AttachmentDetachResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "bindingId") &&
    hasStringProperty(value, "blobId") &&
    hasStringProperty(value, "documentId") &&
    hasStringProperty(value, "slotId")
  );
}
