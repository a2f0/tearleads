import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";
import {
  type ContainerV2WriterProjectionResponse,
  isContainerV2WriterProjectionResponse,
} from "./container";

export interface DocumentV2ContentKeyTargetEnvelopeResponse {
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
  wrappedKey: string;
  wrappingMetadata: Record<string, unknown>;
}

export interface DocumentV2KekTargetsResponse {
  documentId: string;
  linkSetManifestHash: string;
  linkedContainerManifestHashes: string[];
  linkedContainerKeyEpochIds: string[];
  targets: Record<string, unknown>[];
  documentKeyTargetHash: string;
}

export interface DocumentV2ContentKeyBundleResponse {
  documentId: string;
  contentKeyEpoch: number;
  linkSetManifestHash: string;
  targetHash: string;
  targets: DocumentV2ContentKeyTargetEnvelopeResponse[];
}

export interface DocumentV2ManifestBundleResponse {
  event: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestHash: string;
  state: Record<string, unknown>;
}

export interface DocumentV2CreateResponse {
  id: string;
  createdAt: string;
  accessManifest: DocumentV2ManifestBundleResponse;
  contentKeyBundle: DocumentV2ContentKeyBundleResponse;
  documentKekTargets: DocumentV2KekTargetsResponse;
}

export interface DocumentV2SyncUpdateResponse {
  accessEpoch: number;
  id: string;
  documentId: string;
  authorFingerprint: string;
  encryptedData: string;
  partialStartVersionVector: string;
  partialEndVersionVector: string;
  createdAt: string;
  writeHeader: Record<string, unknown>;
  writeHeaderHash: string;
}

export interface DocumentV2SyncResponse {
  acceptedOutgoingUpdateIds: string[];
  commitLsn: string | null;
  contentKeyBundle: DocumentV2ContentKeyBundleResponse;
  documentId: string;
  documentKekTargets: DocumentV2KekTargetsResponse;
  missingUpdateEpochs: ("prior_epoch" | "current_epoch")[];
  updates: DocumentV2SyncUpdateResponse[];
}

export interface DocumentV2WriterProjectionResponse {
  documentId: string;
  documentManifest: DocumentV2ManifestBundleResponse;
  documentKekTargets: DocumentV2KekTargetsResponse;
  contentKeyBundle: DocumentV2ContentKeyBundleResponse;
  authorizingContainerPaths: ContainerV2WriterProjectionResponse[];
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isPlainObject);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

function isMissingUpdateEpoch(value: unknown) {
  return value === "prior_epoch" || value === "current_epoch";
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

function isAccessEventBundleResponse(
  value: unknown,
): value is Record<string, unknown> {
  const signedEvent = isPlainObject(value)
    ? Reflect.get(value, "event")
    : undefined;
  const body = isPlainObject(value) ? Reflect.get(value, "body") : undefined;

  return (
    isPlainObject(value) &&
    isPlainObject(signedEvent) &&
    Reflect.has(value, "body") &&
    body !== undefined &&
    hasStringProperty(value, "eventHash") &&
    value.eventHash.length > 0
  );
}

function isDocumentV2ManifestBundleResponse(
  value: unknown,
): value is DocumentV2ManifestBundleResponse {
  const event = isPlainObject(value) ? Reflect.get(value, "event") : undefined;
  const manifest = isPlainObject(value)
    ? Reflect.get(value, "manifest")
    : undefined;
  const state = isPlainObject(value) ? Reflect.get(value, "state") : undefined;

  return (
    isPlainObject(value) &&
    isAccessEventBundleResponse(event) &&
    isPlainObject(manifest) &&
    hasStringProperty(value, "manifestHash") &&
    value.manifestHash.length > 0 &&
    isPlainObject(state)
  );
}

function isDocumentV2ContentKeyTargetEnvelopeResponse(
  value: unknown,
): value is DocumentV2ContentKeyTargetEnvelopeResponse {
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

function isDocumentV2KekTargetsResponse(
  value: unknown,
): value is DocumentV2KekTargetsResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "documentId") &&
    hasStringProperty(value, "linkSetManifestHash") &&
    value.linkSetManifestHash.length > 0 &&
    hasArrayProperty(value, "linkedContainerManifestHashes") &&
    isNonEmptyStringArray(value.linkedContainerManifestHashes) &&
    hasArrayProperty(value, "linkedContainerKeyEpochIds") &&
    isNonEmptyStringArray(value.linkedContainerKeyEpochIds) &&
    hasArrayProperty(value, "targets") &&
    isRecordArray(value.targets) &&
    value.targets.length > 0 &&
    hasStringProperty(value, "documentKeyTargetHash") &&
    value.documentKeyTargetHash.length > 0
  );
}

function isDocumentV2ContentKeyBundleResponse(
  value: unknown,
): value is DocumentV2ContentKeyBundleResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "documentId") &&
    hasPositiveNumberProperty(value, "contentKeyEpoch") &&
    hasStringProperty(value, "linkSetManifestHash") &&
    value.linkSetManifestHash.length > 0 &&
    hasStringProperty(value, "targetHash") &&
    value.targetHash.length > 0 &&
    hasArrayProperty(value, "targets") &&
    value.targets.length > 0 &&
    value.targets.every(isDocumentV2ContentKeyTargetEnvelopeResponse)
  );
}

function isDocumentV2SyncUpdateResponse(
  value: unknown,
): value is DocumentV2SyncUpdateResponse {
  const writeHeader = isPlainObject(value)
    ? Reflect.get(value, "writeHeader")
    : undefined;

  return (
    isPlainObject(value) &&
    hasPositiveNumberProperty(value, "accessEpoch") &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "documentId") &&
    hasStringProperty(value, "authorFingerprint") &&
    hasStringProperty(value, "encryptedData") &&
    hasStringProperty(value, "partialStartVersionVector") &&
    hasStringProperty(value, "partialEndVersionVector") &&
    hasStringProperty(value, "createdAt") &&
    isPlainObject(writeHeader) &&
    hasStringProperty(value, "writeHeaderHash") &&
    value.writeHeaderHash.length > 0
  );
}

export function isDocumentV2CreateResponse(
  value: unknown,
): value is DocumentV2CreateResponse {
  const accessManifest = isPlainObject(value)
    ? Reflect.get(value, "accessManifest")
    : undefined;
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;
  const documentKekTargets = isPlainObject(value)
    ? Reflect.get(value, "documentKekTargets")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "id") &&
    hasStringProperty(value, "createdAt") &&
    isDocumentV2ManifestBundleResponse(accessManifest) &&
    isDocumentV2ContentKeyBundleResponse(contentKeyBundle) &&
    isDocumentV2KekTargetsResponse(documentKekTargets)
  );
}

export function isDocumentV2SyncResponse(
  value: unknown,
): value is DocumentV2SyncResponse {
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;
  const documentKekTargets = isPlainObject(value)
    ? Reflect.get(value, "documentKekTargets")
    : undefined;

  return (
    isPlainObject(value) &&
    hasArrayProperty(value, "acceptedOutgoingUpdateIds") &&
    isStringArray(value.acceptedOutgoingUpdateIds) &&
    hasNullableStringProperty(value, "commitLsn") &&
    isDocumentV2ContentKeyBundleResponse(contentKeyBundle) &&
    hasStringProperty(value, "documentId") &&
    isDocumentV2KekTargetsResponse(documentKekTargets) &&
    hasArrayProperty(value, "missingUpdateEpochs") &&
    value.missingUpdateEpochs.every(isMissingUpdateEpoch) &&
    hasArrayProperty(value, "updates") &&
    value.updates.every(isDocumentV2SyncUpdateResponse)
  );
}

export function isDocumentV2WriterProjectionResponse(
  value: unknown,
): value is DocumentV2WriterProjectionResponse {
  const documentManifest = isPlainObject(value)
    ? Reflect.get(value, "documentManifest")
    : undefined;
  const documentKekTargets = isPlainObject(value)
    ? Reflect.get(value, "documentKekTargets")
    : undefined;
  const contentKeyBundle = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundle")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "documentId") &&
    isDocumentV2ManifestBundleResponse(documentManifest) &&
    isDocumentV2KekTargetsResponse(documentKekTargets) &&
    isDocumentV2ContentKeyBundleResponse(contentKeyBundle) &&
    hasArrayProperty(value, "authorizingContainerPaths") &&
    value.authorizingContainerPaths.length > 0 &&
    value.authorizingContainerPaths.every(isContainerV2WriterProjectionResponse)
  );
}
