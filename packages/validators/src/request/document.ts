import { isPlainObject } from "../isPlainObject";
import {
  type AccessManifestBundleWire,
  hasArrayProperty,
  hasPositiveIntegerProperty,
  hasStringProperty,
  isAccessManifestBundleWire,
  isOptionalRecordArray,
  isOptionalRecordArrayArray,
  isRecordArray,
  isRecordArrayArray,
  isUuidV4String,
  isWalLsnString,
} from "../util";
import {
  type ContainerMutationRequest,
  isOptionalContainerMutationRequestArray,
} from "./container";

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
  previousManifest?: AccessManifestBundleWire | null;
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
  previousManifest: AccessManifestBundleWire;
  targetContainerPath: Record<string, unknown>[];
  authorizingContainerPaths: Record<string, unknown>[][];
  containerRekeys?: ContainerMutationRequest[];
  contentKeyBundle: DocumentContentKeyBundleRequest;
}

export interface DocumentOutgoingUpdate {
  checkpointKind?: "rotate_baseline";
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
  documentManifest?: AccessManifestBundleWire;
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  authorizingContainerPaths?: Record<string, unknown>[][];
  localVersionVector: string | null;
  minLsn?: string;
  outgoingUpdates: DocumentOutgoingUpdate[];
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
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
    hasPositiveIntegerProperty(value, "containerKeyEpoch") &&
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
    hasPositiveIntegerProperty(value, "contentKeyEpoch") &&
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
    isUuidV4String(value.id) &&
    hasStringProperty(value, "encryptedData") &&
    value.encryptedData.length > 0 &&
    hasStringProperty(value, "partialStartVersionVector") &&
    value.partialStartVersionVector.length > 0 &&
    hasStringProperty(value, "partialEndVersionVector") &&
    value.partialEndVersionVector.length > 0 &&
    (checkpointKind === undefined || checkpointKind === "rotate_baseline") &&
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
      isAccessManifestBundleWire(previousManifest)) &&
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
    isAccessManifestBundleWire(previousManifest) &&
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
  const hasUniqueOutgoingUpdateIds =
    !Array.isArray(outgoingUpdates) ||
    new Set(
      outgoingUpdates
        .filter(isPlainObject)
        .map((update) => Reflect.get(update, "id")),
    ).size === outgoingUpdates.length;
  const hasContainerRekeys =
    Array.isArray(containerRekeys) && containerRekeys.length > 0;

  return (
    isPlainObject(value) &&
    (contentKeyBundle === undefined ||
      isDocumentContentKeyBundleRequest(contentKeyBundle)) &&
    (documentManifest === undefined
      ? !hasOutgoingUpdates
      : isAccessManifestBundleWire(documentManifest)) &&
    hasPositiveIntegerProperty(value, "contentKeyEpoch") &&
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
    hasUniqueOutgoingUpdateIds &&
    value.outgoingUpdates.every(isDocumentOutgoingUpdate)
  );
}
