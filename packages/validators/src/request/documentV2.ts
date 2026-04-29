import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
  isWalLsnString,
} from "../util";

export interface DocumentV2ManifestBundle {
  event: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestHash: string;
  state: Record<string, unknown>;
}

export interface DocumentV2ContentKeyTargetEnvelope {
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
  wrappedKey: string;
  wrappingMetadata: Record<string, unknown>;
}

export interface DocumentV2ContentKeyBundleRequest {
  contentKeyEpoch: number;
  linkSetManifestHash: string;
  targetHash: string;
  targets: DocumentV2ContentKeyTargetEnvelope[];
}

export interface DocumentV2CreateRequest {
  event: Record<string, unknown>;
  body: unknown;
  expectedManifestHash: string;
  manifest: Record<string, unknown>;
  previousManifest?: DocumentV2ManifestBundle | null;
  targetContainerPath?: Record<string, unknown>[];
  authorizingContainerPaths?: Record<string, unknown>[][];
  contentKeyBundle: DocumentV2ContentKeyBundleRequest;
}

export interface DocumentV2LinkSetMutationRequest {
  event: Record<string, unknown>;
  body: unknown;
  expectedManifestHash: string;
  manifest: Record<string, unknown>;
  previousManifest: DocumentV2ManifestBundle;
  targetContainerPath: Record<string, unknown>[];
  authorizingContainerPaths: Record<string, unknown>[][];
  contentKeyBundle: DocumentV2ContentKeyBundleRequest;
}

export interface DocumentV2OutgoingUpdate {
  checkpointKind?: "fresh_baseline" | "rotate_baseline";
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string;
  writeHeader: Record<string, unknown>;
}

export interface DocumentV2SyncRequest {
  contentKeyBundle?: DocumentV2ContentKeyBundleRequest;
  contentKeyEpoch: number;
  documentManifest?: DocumentV2ManifestBundle;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  authorizingContainerPaths?: Record<string, unknown>[][];
  localVersionVector: string | null;
  minLsn?: string;
  outgoingUpdates: DocumentV2OutgoingUpdate[];
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

function isRecordArrayArray(
  value: unknown,
): value is Record<string, unknown>[][] {
  return Array.isArray(value) && value.every(isRecordArray);
}

function isOptionalRecordArray(
  value: unknown,
): value is Record<string, unknown>[] | undefined {
  return value === undefined || isRecordArray(value);
}

function isOptionalRecordArrayArray(
  value: unknown,
): value is Record<string, unknown>[][] | undefined {
  return value === undefined || isRecordArrayArray(value);
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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isDocumentV2ManifestBundle(
  value: unknown,
): value is DocumentV2ManifestBundle {
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

function isDocumentV2ContentKeyTargetEnvelope(
  value: unknown,
): value is DocumentV2ContentKeyTargetEnvelope {
  const wrappingMetadata = isPlainObject(value)
    ? Reflect.get(value, "wrappingMetadata")
    : undefined;

  return (
    isPlainObject(value) &&
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

export function isDocumentV2ContentKeyBundleRequest(
  value: unknown,
): value is DocumentV2ContentKeyBundleRequest {
  return (
    isPlainObject(value) &&
    hasPositiveNumberProperty(value, "contentKeyEpoch") &&
    hasStringProperty(value, "linkSetManifestHash") &&
    value.linkSetManifestHash.length > 0 &&
    hasStringProperty(value, "targetHash") &&
    value.targetHash.length > 0 &&
    hasArrayProperty(value, "targets") &&
    value.targets.every(isDocumentV2ContentKeyTargetEnvelope)
  );
}

function isDocumentV2OutgoingUpdate(
  value: unknown,
): value is DocumentV2OutgoingUpdate {
  const checkpointKind = isPlainObject(value)
    ? Reflect.get(value, "checkpointKind")
    : undefined;
  const sourceVersionVector = isPlainObject(value)
    ? Reflect.get(value, "sourceVersionVector")
    : undefined;
  const writeHeader = isPlainObject(value)
    ? Reflect.get(value, "writeHeader")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "encryptedData") &&
    hasStringProperty(value, "partialStartVersionVector") &&
    hasStringProperty(value, "partialEndVersionVector") &&
    (checkpointKind === undefined ||
      checkpointKind === "fresh_baseline" ||
      checkpointKind === "rotate_baseline") &&
    (sourceVersionVector === undefined ||
      hasStringProperty(value, "sourceVersionVector")) &&
    isPlainObject(writeHeader)
  );
}

export function isDocumentV2CreateRequest(
  value: unknown,
): value is DocumentV2CreateRequest {
  const previousManifest = isPlainObject(value)
    ? Reflect.get(value, "previousManifest")
    : undefined;
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const body = isPlainObject(value) ? Reflect.get(value, "body") : undefined;
  const manifest = isPlainObject(value)
    ? Reflect.get(value, "manifest")
    : undefined;
  const targetContainerPath = isPlainObject(value)
    ? Reflect.get(value, "targetContainerPath")
    : undefined;
  const authorizingContainerPaths = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPaths")
    : undefined;
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    hasStringProperty(value, "expectedManifestHash") &&
    value.expectedManifestHash.length > 0 &&
    isPlainObject(manifest) &&
    (previousManifest === undefined ||
      previousManifest === null ||
      isDocumentV2ManifestBundle(previousManifest)) &&
    isOptionalRecordArray(targetContainerPath) &&
    isOptionalRecordArrayArray(authorizingContainerPaths) &&
    isDocumentV2ContentKeyBundleRequest(contentKeyBundle)
  );
}

export function isDocumentV2LinkSetMutationRequest(
  value: unknown,
): value is DocumentV2LinkSetMutationRequest {
  const previousManifest = isPlainObject(value)
    ? Reflect.get(value, "previousManifest")
    : undefined;
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const body = isPlainObject(value) ? Reflect.get(value, "body") : undefined;
  const manifest = isPlainObject(value)
    ? Reflect.get(value, "manifest")
    : undefined;
  const targetContainerPath = isPlainObject(value)
    ? Reflect.get(value, "targetContainerPath")
    : undefined;
  const authorizingContainerPaths = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPaths")
    : undefined;
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    hasStringProperty(value, "expectedManifestHash") &&
    value.expectedManifestHash.length > 0 &&
    isPlainObject(manifest) &&
    isDocumentV2ManifestBundle(previousManifest) &&
    isRecordArray(targetContainerPath) &&
    isRecordArrayArray(authorizingContainerPaths) &&
    isDocumentV2ContentKeyBundleRequest(contentKeyBundle)
  );
}

export function isDocumentV2SyncRequest(
  value: unknown,
): value is DocumentV2SyncRequest {
  const authorizingContainerPaths = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPaths")
    : undefined;
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;
  const documentManifest = isPlainObject(value)
    ? Reflect.get(value, "documentManifest")
    : undefined;
  const minLsn = isPlainObject(value)
    ? Reflect.get(value, "minLsn")
    : undefined;
  const outgoingUpdates = isPlainObject(value)
    ? Reflect.get(value, "outgoingUpdates")
    : undefined;
  const hasOutgoingUpdates =
    Array.isArray(outgoingUpdates) && outgoingUpdates.length > 0;

  return (
    isPlainObject(value) &&
    (contentKeyBundle === undefined ||
      isDocumentV2ContentKeyBundleRequest(contentKeyBundle)) &&
    (documentManifest === undefined
      ? !hasOutgoingUpdates
      : isDocumentV2ManifestBundle(documentManifest)) &&
    hasPositiveNumberProperty(value, "contentKeyEpoch") &&
    hasStringProperty(value, "expectedLinkSetManifestHash") &&
    value.expectedLinkSetManifestHash.length > 0 &&
    hasStringProperty(value, "expectedTargetHash") &&
    value.expectedTargetHash.length > 0 &&
    (authorizingContainerPaths === undefined
      ? !hasOutgoingUpdates
      : isRecordArrayArray(authorizingContainerPaths)) &&
    isNullableString(Reflect.get(value, "localVersionVector")) &&
    (minLsn === undefined || isWalLsnString(minLsn)) &&
    hasArrayProperty(value, "outgoingUpdates") &&
    value.outgoingUpdates.every(isDocumentV2OutgoingUpdate)
  );
}
