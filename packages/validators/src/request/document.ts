import { isPlainObject } from "../isPlainObject";
import {
  type AccessManifestBundleWire,
  hasArrayProperty,
  hasPositiveIntegerProperty,
  hasStringProperty,
  isAccessManifestBundleWire,
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
  // Container access manifests authorizing the write, as hash references the
  // server resolves from its own store (it already holds these committed
  // containers — see ContainerManifestRef).
  targetContainerPathRefs?: ContainerManifestRef[];
  authorizingContainerPathRefs?: ContainerManifestRef[][];
  containerRekeys?: ContainerMutationRequest[];
  contentKeyBundle: DocumentContentKeyBundleRequest;
}

export interface DocumentLinkSetMutationRequest {
  event: Record<string, unknown>;
  body: unknown;
  expectedManifestHash: string;
  manifest: Record<string, unknown>;
  previousManifest: AccessManifestBundleWire;
  // Container access manifests authorizing the write, as hash references the
  // server resolves from its own store.
  targetContainerPathRefs: ContainerManifestRef[];
  authorizingContainerPathRefs: ContainerManifestRef[][];
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

/**
 * A reference to a container access manifest the server already stores, in lieu
 * of re-embedding the full signed manifest bundle. The server resolves the full
 * manifest from its own store by `manifestHash` and pins it to the container's
 * current head, so the reference carries the same authority as the full bundle
 * without the multi-KB signature. `containerId` is advisory: the server keys the
 * head lookup off the resolved bundle's own containerId and rejects a mismatch.
 */
export interface ContainerManifestRef {
  containerId: string;
  manifestHash: string;
}

export interface DocumentSyncRequest {
  contentKeyBundle?: DocumentContentKeyBundleRequest;
  containerRekeys?: ContainerMutationRequest[];
  contentKeyEpoch: number;
  // The document's current link-set manifest is identified by
  // expectedLinkSetManifestHash; the server resolves the full manifest from its
  // own store rather than having the writer echo the signed bundle back.
  expectedLinkSetManifestHash: string;
  expectedTargetHash: string;
  // Container access manifests authorizing the write, as hash references the
  // server resolves from its own store. Required when there are outgoing
  // updates. (The server already holds these manifests; re-embedding the full
  // signed bundles would only bloat every write.)
  authorizingContainerPathRefs?: ContainerManifestRef[][];
  localVersionVector: string | null;
  minLsn?: string;
  outgoingUpdates: DocumentOutgoingUpdate[];
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isContainerManifestRef(value: unknown): value is ContainerManifestRef {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "containerId") &&
    value.containerId.length > 0 &&
    hasStringProperty(value, "manifestHash") &&
    value.manifestHash.length > 0
  );
}

// A container path (root→leaf chain) must carry at least one manifest
// reference; an empty path authorizes nothing and is never legitimately built.
function isContainerManifestRefArray(
  value: unknown,
): value is ContainerManifestRef[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isContainerManifestRef)
  );
}

export function isContainerManifestRefArrayArray(
  value: unknown,
): value is ContainerManifestRef[][] {
  return Array.isArray(value) && value.every(isContainerManifestRefArray);
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
  const targetContainerPathRefs = isPlainObject(value)
    ? Reflect.get(value, "targetContainerPathRefs")
    : undefined;
  const authorizingContainerPathRefs = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPathRefs")
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
    (targetContainerPathRefs === undefined ||
      isContainerManifestRefArray(targetContainerPathRefs)) &&
    (authorizingContainerPathRefs === undefined ||
      isContainerManifestRefArrayArray(authorizingContainerPathRefs)) &&
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
  const targetContainerPathRefs = isPlainObject(value)
    ? Reflect.get(value, "targetContainerPathRefs")
    : undefined;
  const authorizingContainerPathRefs = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPathRefs")
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
    isContainerManifestRefArray(targetContainerPathRefs) &&
    isContainerManifestRefArrayArray(authorizingContainerPathRefs) &&
    isOptionalContainerMutationRequestArray(containerRekeys) &&
    isDocumentContentKeyBundleRequest(contentKeyBundle)
  );
}

export function isDocumentSyncRequest(
  value: unknown,
): value is DocumentSyncRequest {
  const authorizingContainerPathRefs = isPlainObject(value)
    ? Reflect.get(value, "authorizingContainerPathRefs")
    : undefined;
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;
  const containerRekeys = isPlainObject(value)
    ? Reflect.get(value, "containerRekeys")
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
    hasPositiveIntegerProperty(value, "contentKeyEpoch") &&
    hasStringProperty(value, "expectedLinkSetManifestHash") &&
    value.expectedLinkSetManifestHash.length > 0 &&
    hasStringProperty(value, "expectedTargetHash") &&
    value.expectedTargetHash.length > 0 &&
    (authorizingContainerPathRefs === undefined
      ? !hasOutgoingUpdates
      : isContainerManifestRefArrayArray(authorizingContainerPathRefs)) &&
    isOptionalContainerMutationRequestArray(containerRekeys) &&
    (!hasContainerRekeys || hasOutgoingUpdates) &&
    isNullableString(Reflect.get(value, "localVersionVector")) &&
    (minLsn === undefined || isWalLsnString(minLsn)) &&
    hasArrayProperty(value, "outgoingUpdates") &&
    hasUniqueOutgoingUpdateIds &&
    value.outgoingUpdates.every(isDocumentOutgoingUpdate)
  );
}
