import { isPlainObject } from "../isPlainObject";
import {
  type AccessManifestBundleWireResponse,
  hasArrayProperty,
  hasNullableStringProperty,
  hasPositiveIntegerProperty,
  hasStringProperty,
  isAccessManifestBundleWireResponse,
  isNonEmptyStringArray,
  isRecordArray,
  isStringArray,
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

export interface DocumentCreateResponse {
  id: string;
  createdAt: string;
  accessManifest: AccessManifestBundleWireResponse;
  contentKeyBundle: DocumentContentKeyBundleResponse;
  documentKekTargets: DocumentKekTargetsResponse;
}

export interface DocumentLinkSetMutationResponse {
  id: string;
  accessManifest: AccessManifestBundleWireResponse;
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
  contentKeyBundles?: DocumentContentKeyBundleResponse[];
  documentId: string;
  documentKekTargets: DocumentKekTargetsResponse;
  missingUpdateEpochs: ("prior_epoch" | "current_epoch")[];
  updates: DocumentSyncUpdateResponse[];
}

export interface DocumentWriterProjectionResponse {
  documentId: string;
  documentManifest: AccessManifestBundleWireResponse;
  documentManifestHistory?: AccessManifestBundleWireResponse[];
  documentManifestContainerPaths?: AccessManifestBundleWireResponse[][];
  documentContainerManifestHistory?: AccessManifestBundleWireResponse[];
  documentKekTargets: DocumentKekTargetsResponse;
  contentKeyBundle: DocumentContentKeyBundleResponse;
  authorizingContainerPaths: ContainerWriterProjectionResponse[];
}

function isMissingUpdateEpoch(value: unknown) {
  return value === "prior_epoch" || value === "current_epoch";
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
    hasPositiveIntegerProperty(value, "containerKeyEpoch") &&
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
    hasPositiveIntegerProperty(value, "contentKeyEpoch") &&
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
    hasPositiveIntegerProperty(value, "accessEpoch") &&
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
    isAccessManifestBundleWireResponse(accessManifest) &&
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
    isAccessManifestBundleWireResponse(accessManifest) &&
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
  const contentKeyBundles = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundles")
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
    (contentKeyBundles === undefined ||
      (Array.isArray(contentKeyBundles) &&
        contentKeyBundles.every(isDocumentContentKeyBundleResponse))) &&
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
  const documentManifestHistory = isPlainObject(value)
    ? Reflect.get(value, "documentManifestHistory")
    : undefined;
  const documentManifestContainerPaths = isPlainObject(value)
    ? Reflect.get(value, "documentManifestContainerPaths")
    : undefined;
  const documentContainerManifestHistory = isPlainObject(value)
    ? Reflect.get(value, "documentContainerManifestHistory")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "documentId") &&
    isAccessManifestBundleWireResponse(documentManifest) &&
    (documentManifestHistory === undefined ||
      (Array.isArray(documentManifestHistory) &&
        documentManifestHistory.every(isAccessManifestBundleWireResponse))) &&
    (documentManifestContainerPaths === undefined ||
      (Array.isArray(documentManifestContainerPaths) &&
        documentManifestContainerPaths.every(
          (path) =>
            Array.isArray(path) &&
            path.every(isAccessManifestBundleWireResponse),
        ))) &&
    (documentContainerManifestHistory === undefined ||
      (Array.isArray(documentContainerManifestHistory) &&
        documentContainerManifestHistory.every(
          isAccessManifestBundleWireResponse,
        ))) &&
    isDocumentKekTargetsResponse(documentKekTargets) &&
    isDocumentContentKeyBundleResponse(contentKeyBundle) &&
    hasArrayProperty(value, "authorizingContainerPaths") &&
    value.authorizingContainerPaths.length > 0 &&
    value.authorizingContainerPaths.every(isContainerWriterProjectionResponse)
  );
}
