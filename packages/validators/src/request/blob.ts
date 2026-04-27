import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";

export interface StageBlobRequest {
  encryptedBytes: string;
  byteLength: number;
  sha256: string;
}

export interface BlobV2ManifestBundleRequest {
  event: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestHash: string;
  state: Record<string, unknown>;
}

export interface BlobV2ContentKeyTargetEnvelopeRequest {
  bindingId: string;
  documentId: string;
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
  wrappedKey: string;
  wrappingMetadata: Record<string, unknown>;
}

export interface BlobV2ContentKeyBundleRequest {
  contentKeyEpoch: number;
  targetHash: string;
  targets: BlobV2ContentKeyTargetEnvelopeRequest[];
}

export interface BlobV2StagedBlobRequest {
  stageId: string;
  writeHeader: Record<string, unknown>;
}

export interface BlobV2AttachmentBindRequest {
  event: Record<string, unknown>;
  body: unknown;
  documentManifest: BlobV2ManifestBundleRequest;
  authorizingContainerPaths: Record<string, unknown>[][];
  contentKeyBundle: BlobV2ContentKeyBundleRequest;
  stagedBlob?: BlobV2StagedBlobRequest;
}

export interface BlobV2AttachmentDetachRequest {
  event: Record<string, unknown>;
  body: unknown;
  documentManifest: BlobV2ManifestBundleRequest;
  authorizingContainerPaths: Record<string, unknown>[][];
}

export function isStageBlobRequest(value: unknown): value is StageBlobRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "encryptedBytes") &&
    hasNumberProperty(value, "byteLength") &&
    Number.isInteger(value.byteLength) &&
    value.byteLength > 0 &&
    hasStringProperty(value, "sha256") &&
    value.sha256.length > 0
  );
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

function isRecordArrayArray(
  value: unknown,
): value is Record<string, unknown>[][] {
  return Array.isArray(value) && value.every(isRecordArray);
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

function isBlobV2ManifestBundleRequest(
  value: unknown,
): value is BlobV2ManifestBundleRequest {
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const manifest = isPlainObject(value)
    ? Reflect.get(value, "manifest")
    : undefined;
  const state = isPlainObject(value) ? Reflect.get(value, "state") : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    isPlainObject(manifest) &&
    hasStringProperty(value, "manifestHash") &&
    value.manifestHash.length > 0 &&
    isPlainObject(state)
  );
}

function isBlobV2ContentKeyTargetEnvelopeRequest(
  value: unknown,
): value is BlobV2ContentKeyTargetEnvelopeRequest {
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
    hasPositiveNumberProperty(value, "containerKeyEpoch") &&
    hasStringProperty(value, "wrappedKey") &&
    value.wrappedKey.length > 0 &&
    isPlainObject(wrappingMetadata)
  );
}

function isBlobV2ContentKeyBundleRequest(
  value: unknown,
): value is BlobV2ContentKeyBundleRequest {
  return (
    isPlainObject(value) &&
    hasPositiveNumberProperty(value, "contentKeyEpoch") &&
    hasStringProperty(value, "targetHash") &&
    value.targetHash.length > 0 &&
    hasArrayProperty(value, "targets") &&
    value.targets.every(isBlobV2ContentKeyTargetEnvelopeRequest)
  );
}

function isBlobV2StagedBlobRequest(
  value: unknown,
): value is BlobV2StagedBlobRequest {
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

export function isBlobV2AttachmentBindRequest(
  value: unknown,
): value is BlobV2AttachmentBindRequest {
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const body = isPlainObject(value) ? Reflect.get(value, "body") : undefined;
  const documentManifest = isPlainObject(value)
    ? Reflect.get(value, "documentManifest")
    : undefined;
  const authorizingContainerPaths = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPaths")
    : undefined;
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;
  const stagedBlob = isPlainObject(value)
    ? Reflect.get(value, "stagedBlob")
    : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    isBlobV2ManifestBundleRequest(documentManifest) &&
    isRecordArrayArray(authorizingContainerPaths) &&
    isBlobV2ContentKeyBundleRequest(contentKeyBundle) &&
    (stagedBlob === undefined || isBlobV2StagedBlobRequest(stagedBlob))
  );
}

export function isBlobV2AttachmentDetachRequest(
  value: unknown,
): value is BlobV2AttachmentDetachRequest {
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const body = isPlainObject(value) ? Reflect.get(value, "body") : undefined;
  const documentManifest = isPlainObject(value)
    ? Reflect.get(value, "documentManifest")
    : undefined;
  const authorizingContainerPaths = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPaths")
    : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    isBlobV2ManifestBundleRequest(documentManifest) &&
    isRecordArrayArray(authorizingContainerPaths)
  );
}
