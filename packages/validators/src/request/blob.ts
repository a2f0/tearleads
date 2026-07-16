import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasPositiveIntegerProperty,
  hasStringProperty,
} from "../util";
import {
  type ContainerMutationRequest,
  isOptionalContainerMutationRequestArray,
} from "./container";
import {
  type ContainerManifestRef,
  isContainerManifestRefArrayArray,
} from "./document";

export interface InitiateMultipartBlobStageRequest {
  byteLength: number;
  sha256: string;
}

export interface MultipartBlobPartCommitRequest {
  etag: string;
  partNumber: number;
}

export interface CompleteMultipartBlobStageRequest {
  parts: MultipartBlobPartCommitRequest[];
  uploadId: string;
}

export interface BlobContentKeyTargetEnvelopeRequest {
  bindingId: string;
  documentId: string;
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
  wrappedKey: string;
  wrappingMetadata: Record<string, unknown>;
}

export interface BlobContentKeyBundleRequest {
  contentKeyEpoch: number;
  targetHash: string;
  targets: BlobContentKeyTargetEnvelopeRequest[];
}

export interface BlobStagedBlobRequest {
  stageId: string;
  writeHeader: Record<string, unknown>;
}

export interface BlobAttachmentBindRequest {
  event: Record<string, unknown>;
  body: unknown;
  // The attachment's document link-set manifest is the document's current head;
  // the server resolves it from its own store (the signed write header pins
  // freshness), so the writer no longer echoes the bundle back.
  authorizingContainerPathRefs: ContainerManifestRef[][];
  containerRekeys?: ContainerMutationRequest[];
  contentKeyBundle: BlobContentKeyBundleRequest;
  stagedBlob?: BlobStagedBlobRequest;
}

export interface BlobAttachmentDetachRequest {
  event: Record<string, unknown>;
  body: unknown;
  authorizingContainerPathRefs: ContainerManifestRef[][];
  containerRekeys?: ContainerMutationRequest[];
}

export function isInitiateMultipartBlobStageRequest(
  value: unknown,
): value is InitiateMultipartBlobStageRequest {
  return (
    isPlainObject(value) &&
    hasNumberProperty(value, "byteLength") &&
    Number.isInteger(value.byteLength) &&
    value.byteLength > 0 &&
    hasStringProperty(value, "sha256") &&
    value.sha256.length > 0
  );
}

function isMultipartBlobPartCommitRequest(
  value: unknown,
): value is MultipartBlobPartCommitRequest {
  return (
    isPlainObject(value) &&
    hasPositiveIntegerProperty(value, "partNumber") &&
    hasStringProperty(value, "etag") &&
    value.etag.length > 0
  );
}

export function isCompleteMultipartBlobStageRequest(
  value: unknown,
): value is CompleteMultipartBlobStageRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "uploadId") &&
    value.uploadId.length > 0 &&
    hasArrayProperty(value, "parts") &&
    value.parts.length > 0 &&
    value.parts.every(isMultipartBlobPartCommitRequest)
  );
}

function isBlobContentKeyTargetEnvelopeRequest(
  value: unknown,
): value is BlobContentKeyTargetEnvelopeRequest {
  const wrappingMetadata = isPlainObject(value)
    ? Reflect.get(value, "wrappingMetadata")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "bindingId") &&
    value.bindingId.length > 0 &&
    hasStringProperty(value, "documentId") &&
    value.documentId.length > 0 &&
    hasStringProperty(value, "containerId") &&
    value.containerId.length > 0 &&
    hasStringProperty(value, "containerManifestHash") &&
    value.containerManifestHash.length > 0 &&
    hasStringProperty(value, "containerKeyEpochId") &&
    value.containerKeyEpochId.length > 0 &&
    hasPositiveIntegerProperty(value, "containerKeyEpoch") &&
    hasStringProperty(value, "wrappedKey") &&
    value.wrappedKey.length > 0 &&
    isPlainObject(wrappingMetadata)
  );
}

function isBlobContentKeyBundleRequest(
  value: unknown,
): value is BlobContentKeyBundleRequest {
  return (
    isPlainObject(value) &&
    hasPositiveIntegerProperty(value, "contentKeyEpoch") &&
    hasStringProperty(value, "targetHash") &&
    value.targetHash.length > 0 &&
    hasArrayProperty(value, "targets") &&
    value.targets.every(isBlobContentKeyTargetEnvelopeRequest)
  );
}

function isBlobStagedBlobRequest(
  value: unknown,
): value is BlobStagedBlobRequest {
  const writeHeader = isPlainObject(value)
    ? Reflect.get(value, "writeHeader")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "stageId") &&
    value.stageId.length > 0 &&
    isPlainObject(writeHeader)
  );
}

export function isBlobAttachmentBindRequest(
  value: unknown,
): value is BlobAttachmentBindRequest {
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const body = isPlainObject(value) ? Reflect.get(value, "body") : undefined;
  const authorizingContainerPathRefs = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPathRefs")
    : undefined;
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;
  const containerRekeys = isPlainObject(value)
    ? Reflect.get(value, "containerRekeys")
    : undefined;
  const stagedBlob = isPlainObject(value)
    ? Reflect.get(value, "stagedBlob")
    : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    isContainerManifestRefArrayArray(authorizingContainerPathRefs) &&
    isOptionalContainerMutationRequestArray(containerRekeys) &&
    isBlobContentKeyBundleRequest(contentKeyBundle) &&
    (stagedBlob === undefined || isBlobStagedBlobRequest(stagedBlob))
  );
}

export function isBlobAttachmentDetachRequest(
  value: unknown,
): value is BlobAttachmentDetachRequest {
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const body = isPlainObject(value) ? Reflect.get(value, "body") : undefined;
  const authorizingContainerPathRefs = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPathRefs")
    : undefined;
  const containerRekeys = isPlainObject(value)
    ? Reflect.get(value, "containerRekeys")
    : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    isContainerManifestRefArrayArray(authorizingContainerPathRefs) &&
    isOptionalContainerMutationRequestArray(containerRekeys)
  );
}
