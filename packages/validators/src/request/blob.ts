import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";
import {
  type ContainerMutationRequest,
  isOptionalContainerMutationRequestArray,
} from "./container";

export interface StageBlobRequest {
  encryptedBytes: string;
  byteLength: number;
  sha256: string;
}

export interface BlobManifestBundleRequest {
  event: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestHash: string;
  state: Record<string, unknown>;
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
  documentManifest: BlobManifestBundleRequest;
  authorizingContainerPaths: Record<string, unknown>[][];
  containerRekeys?: ContainerMutationRequest[];
  contentKeyBundle: BlobContentKeyBundleRequest;
  stagedBlob?: BlobStagedBlobRequest;
}

export interface BlobAttachmentDetachRequest {
  event: Record<string, unknown>;
  body: unknown;
  documentManifest: BlobManifestBundleRequest;
  authorizingContainerPaths: Record<string, unknown>[][];
  containerRekeys?: ContainerMutationRequest[];
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

function isBlobManifestBundleRequest(
  value: unknown,
): value is BlobManifestBundleRequest {
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
    hasPositiveNumberProperty(value, "containerKeyEpoch") &&
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
    hasPositiveNumberProperty(value, "contentKeyEpoch") &&
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
  const documentManifest = isPlainObject(value)
    ? Reflect.get(value, "documentManifest")
    : undefined;
  const authorizingContainerPaths = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPaths")
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
    isBlobManifestBundleRequest(documentManifest) &&
    isRecordArrayArray(authorizingContainerPaths) &&
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
  const documentManifest = isPlainObject(value)
    ? Reflect.get(value, "documentManifest")
    : undefined;
  const authorizingContainerPaths = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPaths")
    : undefined;
  const containerRekeys = isPlainObject(value)
    ? Reflect.get(value, "containerRekeys")
    : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    isBlobManifestBundleRequest(documentManifest) &&
    isRecordArrayArray(authorizingContainerPaths) &&
    isOptionalContainerMutationRequestArray(containerRekeys)
  );
}
