import { isPlainObject } from "../isPlainObject";
import {
  hasArrayProperty,
  hasNullableStringProperty,
  hasNumberProperty,
  hasStringProperty,
} from "../util";
import {
  type ContainerWriterProjectionResponse,
  isContainerWriterProjectionResponse,
} from "./container";

export interface DocumentContentKeyTargetEnvelopeResponse {
  containerId: string;
  containerManifestHash: string;
  containerKeyEpochId: string;
  containerKeyEpoch: number;
  wrappedKey: string;
  wrappingMetadata: Record<string, unknown>;
}

export interface DocumentKekTargetsResponse {
  documentId: string;
  linkSetManifestHash: string;
  linkedContainerManifestHashes: string[];
  linkedContainerKeyEpochIds: string[];
  targets: Record<string, unknown>[];
  documentKeyTargetHash: string;
}

export interface DocumentContentKeyBundleResponse {
  documentId: string;
  contentKeyEpoch: number;
  linkSetManifestHash: string;
  targetHash: string;
  targets: DocumentContentKeyTargetEnvelopeResponse[];
}

export interface DocumentManifestBundleResponse {
  event: Record<string, unknown>;
  manifest: Record<string, unknown>;
  manifestHash: string;
  state: Record<string, unknown>;
}

export interface DocumentCreateResponse {
  id: string;
  createdAt: string;
  accessManifest: DocumentManifestBundleResponse;
  contentKeyBundle: DocumentContentKeyBundleResponse;
  documentKekTargets: DocumentKekTargetsResponse;
}

export interface DocumentLinkSetMutationResponse {
  id: string;
  accessManifest: DocumentManifestBundleResponse;
  contentKeyBundle: DocumentContentKeyBundleResponse;
  documentKekTargets: DocumentKekTargetsResponse;
}

export interface DocumentSyncUpdateResponse {
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

export interface DocumentSyncResponse {
  acceptedOutgoingUpdateIds: string[];
  commitLsn: string | null;
  contentKeyBundle: DocumentContentKeyBundleResponse;
  documentId: string;
  documentKekTargets: DocumentKekTargetsResponse;
  missingUpdateEpochs: ("prior_epoch" | "current_epoch")[];
  updates: DocumentSyncUpdateResponse[];
}

export interface DocumentWriterProjectionResponse {
  documentId: string;
  documentManifest: DocumentManifestBundleResponse;
  documentKekTargets: DocumentKekTargetsResponse;
  contentKeyBundle: DocumentContentKeyBundleResponse;
  authorizingContainerPaths: ContainerWriterProjectionResponse[];
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

function isDocumentManifestBundleResponse(
  value: unknown,
): value is DocumentManifestBundleResponse {
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

function isDocumentContentKeyTargetEnvelopeResponse(
  value: unknown,
): value is DocumentContentKeyTargetEnvelopeResponse {
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

function isDocumentKekTargetsResponse(
  value: unknown,
): value is DocumentKekTargetsResponse {
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

function isDocumentContentKeyBundleResponse(
  value: unknown,
): value is DocumentContentKeyBundleResponse {
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
    value.targets.every(isDocumentContentKeyTargetEnvelopeResponse)
  );
}

function isDocumentSyncUpdateResponse(
  value: unknown,
): value is DocumentSyncUpdateResponse {
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

export function isDocumentCreateResponse(
  value: unknown,
): value is DocumentCreateResponse {
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
    isDocumentManifestBundleResponse(accessManifest) &&
    isDocumentContentKeyBundleResponse(contentKeyBundle) &&
    isDocumentKekTargetsResponse(documentKekTargets)
  );
}

export function isDocumentLinkSetMutationResponse(
  value: unknown,
): value is DocumentLinkSetMutationResponse {
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
    isDocumentManifestBundleResponse(accessManifest) &&
    isDocumentContentKeyBundleResponse(contentKeyBundle) &&
    isDocumentKekTargetsResponse(documentKekTargets)
  );
}

export function isDocumentSyncResponse(
  value: unknown,
): value is DocumentSyncResponse {
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
    isDocumentContentKeyBundleResponse(contentKeyBundle) &&
    hasStringProperty(value, "documentId") &&
    isDocumentKekTargetsResponse(documentKekTargets) &&
    hasArrayProperty(value, "missingUpdateEpochs") &&
    value.missingUpdateEpochs.every(isMissingUpdateEpoch) &&
    hasArrayProperty(value, "updates") &&
    value.updates.every(isDocumentSyncUpdateResponse)
  );
}

export function isDocumentWriterProjectionResponse(
  value: unknown,
): value is DocumentWriterProjectionResponse {
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
    isDocumentManifestBundleResponse(documentManifest) &&
    isDocumentKekTargetsResponse(documentKekTargets) &&
    isDocumentContentKeyBundleResponse(contentKeyBundle) &&
    hasArrayProperty(value, "authorizingContainerPaths") &&
    value.authorizingContainerPaths.length > 0 &&
    value.authorizingContainerPaths.every(isContainerWriterProjectionResponse)
  );
}
