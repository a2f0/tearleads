import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNumberProperty,
  hasStringProperty,
  isWalLsnString,
} from "../util";
import {
  type ContainerMutationRequest,
  isOptionalContainerMutationRequestArray,
} from "./container";

export interface DocumentManifestBundle {
  event: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestHash: string;
  state: Record<string, unknown>;
}

export interface DocumentContentKeyTargetEnvelope {
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
  wrappedKey: string;
  wrappingMetadata: Record<string, unknown>;
}

export interface DocumentContentKeyBundleRequest {
  contentKeyEpoch: number;
  linkSetManifestHash: string;
  targetHash: string;
  targets: DocumentContentKeyTargetEnvelope[];
}

export interface DocumentCreateRequest {
  event: Record<string, unknown>;
  body: unknown;
  expectedManifestHash: string;
  manifest: Record<string, unknown>;
  previousManifest?: DocumentManifestBundle | null;
  targetContainerPath?: Record<string, unknown>[];
  authorizingContainerPaths?: Record<string, unknown>[][];
  containerRekeys?: ContainerMutationRequest[];
  contentKeyBundle: DocumentContentKeyBundleRequest;
}

export interface DocumentLinkSetMutationRequest {
  event: Record<string, unknown>;
  body: unknown;
  expectedManifestHash: string;
  manifest: Record<string, unknown>;
  previousManifest: DocumentManifestBundle;
  targetContainerPath: Record<string, unknown>[];
  authorizingContainerPaths: Record<string, unknown>[][];
  containerRekeys?: ContainerMutationRequest[];
  contentKeyBundle: DocumentContentKeyBundleRequest;
}

export interface DocumentOutgoingUpdate {
  checkpointKind?: "fresh_baseline" | "rotate_baseline";
  id: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  sourceVersionVector?: string;
  writeHeader: Record<string, unknown>;
}

export interface DocumentSyncRequest {
  contentKeyBundle?: DocumentContentKeyBundleRequest;
  containerRekeys?: ContainerMutationRequest[];
  contentKeyEpoch: number;
  documentManifest?: DocumentManifestBundle;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  authorizingContainerPaths?: Record<string, unknown>[][];
  localVersionVector: string | null;
  minLsn?: string;
  outgoingUpdates: DocumentOutgoingUpdate[];
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

function isDocumentManifestBundle(
  value: unknown,
): value is DocumentManifestBundle {
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

function isDocumentContentKeyTargetEnvelope(
  value: unknown,
): value is DocumentContentKeyTargetEnvelope {
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

export function isDocumentContentKeyBundleRequest(
  value: unknown,
): value is DocumentContentKeyBundleRequest {
  return (
    isPlainObject(value) &&
    hasPositiveNumberProperty(value, "contentKeyEpoch") &&
    hasStringProperty(value, "linkSetManifestHash") &&
    value.linkSetManifestHash.length > 0 &&
    hasStringProperty(value, "targetHash") &&
    value.targetHash.length > 0 &&
    hasArrayProperty(value, "targets") &&
    value.targets.every(isDocumentContentKeyTargetEnvelope)
  );
}

function isDocumentOutgoingUpdate(
  value: unknown,
): value is DocumentOutgoingUpdate {
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

export function isDocumentCreateRequest(
  value: unknown,
): value is DocumentCreateRequest {
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
  const containerRekeys = isPlainObject(value)
    ? Reflect.get(value, "containerRekeys")
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
      isDocumentManifestBundle(previousManifest)) &&
    isOptionalRecordArray(targetContainerPath) &&
    isOptionalRecordArrayArray(authorizingContainerPaths) &&
    isOptionalContainerMutationRequestArray(containerRekeys) &&
    isDocumentContentKeyBundleRequest(contentKeyBundle)
  );
}

export function isDocumentLinkSetMutationRequest(
  value: unknown,
): value is DocumentLinkSetMutationRequest {
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
  const containerRekeys = isPlainObject(value)
    ? Reflect.get(value, "containerRekeys")
    : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(event) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    hasStringProperty(value, "expectedManifestHash") &&
    value.expectedManifestHash.length > 0 &&
    isPlainObject(manifest) &&
    isDocumentManifestBundle(previousManifest) &&
    isRecordArray(targetContainerPath) &&
    isRecordArrayArray(authorizingContainerPaths) &&
    isOptionalContainerMutationRequestArray(containerRekeys) &&
    isDocumentContentKeyBundleRequest(contentKeyBundle)
  );
}

export function isDocumentSyncRequest(
  value: unknown,
): value is DocumentSyncRequest {
  const authorizingContainerPaths = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPaths")
    : undefined;
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;
  const containerRekeys = isPlainObject(value)
    ? Reflect.get(value, "containerRekeys")
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
  const hasContainerRekeys =
    Array.isArray(containerRekeys) && containerRekeys.length > 0;

  return (
    isPlainObject(value) &&
    (contentKeyBundle === undefined ||
      isDocumentContentKeyBundleRequest(contentKeyBundle)) &&
    (documentManifest === undefined
      ? !hasOutgoingUpdates
      : isDocumentManifestBundle(documentManifest)) &&
    hasPositiveNumberProperty(value, "contentKeyEpoch") &&
    hasStringProperty(value, "expectedLinkSetManifestHash") &&
    value.expectedLinkSetManifestHash.length > 0 &&
    hasStringProperty(value, "expectedTargetHash") &&
    value.expectedTargetHash.length > 0 &&
    (authorizingContainerPaths === undefined
      ? !hasOutgoingUpdates
      : isRecordArrayArray(authorizingContainerPaths)) &&
    isOptionalContainerMutationRequestArray(containerRekeys) &&
    (!hasContainerRekeys || hasOutgoingUpdates) &&
    isNullableString(Reflect.get(value, "localVersionVector")) &&
    (minLsn === undefined || isWalLsnString(minLsn)) &&
    hasArrayProperty(value, "outgoingUpdates") &&
    value.outgoingUpdates.every(isDocumentOutgoingUpdate)
  );
}
