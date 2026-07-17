import { isPlainObject } from "../isPlainObject";
import {
  type AccessManifestBundleWireResponse,
  hasArrayProperty,
  hasStringProperty,
  isAccessManifestBundleWireResponse,
  isStringArray,
} from "../util";
import {
  type ContainerWriterProjectionResponse,
  isContainerWriterProjectionResponse,
} from "./container";
import {
  type DocumentContentKeyBundleResponse,
  DocumentContentKeyBundleResponseSchema,
  type DocumentKekTargetsResponse,
  DocumentKekTargetsResponseSchema,
  type DocumentSyncResponse,
  DocumentSyncResponseSchema,
} from "./documentSyncSchema";

export {
  type DocumentContentKeyBundleResponse,
  DocumentContentKeyBundleResponseSchema,
  type DocumentContentKeyTargetEnvelopeResponse,
  DocumentContentKeyTargetEnvelopeResponseSchema,
  type DocumentKekTargetsResponse,
  DocumentKekTargetsResponseSchema,
  type DocumentSyncResponse,
  DocumentSyncResponseSchema,
  type DocumentSyncUpdateResponse,
  DocumentSyncUpdateResponseSchema,
} from "./documentSyncSchema";

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

export interface DocumentPurgeResponse {
  documentId: string;
  purgedAt: string;
  reclaimedBlobStorageKeys: string[];
}

export interface DocumentWriterProjectionResponse {
  documentId: string;
  documentManifest: AccessManifestBundleWireResponse;
  documentManifestHistory: AccessManifestBundleWireResponse[];
  documentManifestContainerPaths: AccessManifestBundleWireResponse[][];
  documentContainerManifestHistory: AccessManifestBundleWireResponse[];
  documentKekTargets: DocumentKekTargetsResponse;
  contentKeyBundle: DocumentContentKeyBundleResponse;
  authorizingContainerPaths: ContainerWriterProjectionResponse[];
}

export function isDocumentKekTargetsResponse(
  value: unknown,
): value is DocumentKekTargetsResponse {
  return DocumentKekTargetsResponseSchema.safeParse(value).success;
}

export function isDocumentContentKeyBundleResponse(
  value: unknown,
): value is DocumentContentKeyBundleResponse {
  return DocumentContentKeyBundleResponseSchema.safeParse(value).success;
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

export function isDocumentPurgeResponse(
  value: unknown,
): value is DocumentPurgeResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "documentId") &&
    value.documentId.length > 0 &&
    hasStringProperty(value, "purgedAt") &&
    value.purgedAt.length > 0 &&
    hasArrayProperty(value, "reclaimedBlobStorageKeys") &&
    isStringArray(value.reclaimedBlobStorageKeys)
  );
}

export function isDocumentSyncResponse(
  value: unknown,
): value is DocumentSyncResponse {
  return DocumentSyncResponseSchema.safeParse(value).success;
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
    Array.isArray(documentManifestHistory) &&
    documentManifestHistory.every(isAccessManifestBundleWireResponse) &&
    Array.isArray(documentManifestContainerPaths) &&
    documentManifestContainerPaths.every(
      (path) =>
        Array.isArray(path) && path.every(isAccessManifestBundleWireResponse),
    ) &&
    Array.isArray(documentContainerManifestHistory) &&
    documentContainerManifestHistory.every(
      isAccessManifestBundleWireResponse,
    ) &&
    isDocumentKekTargetsResponse(documentKekTargets) &&
    isDocumentContentKeyBundleResponse(contentKeyBundle) &&
    hasArrayProperty(value, "authorizingContainerPaths") &&
    value.authorizingContainerPaths.length > 0 &&
    value.authorizingContainerPaths.every(isContainerWriterProjectionResponse)
  );
}
