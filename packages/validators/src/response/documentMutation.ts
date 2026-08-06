import { z } from "zod";
import { isPlainObject } from "../isPlainObject";
import { loosePlainObject } from "../schema";
import {
  type AccessManifestBundleWireResponse,
  AccessManifestBundleWireResponseSchema,
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

export const DocumentCreateResponseSchema = loosePlainObject({
  accessManifest: AccessManifestBundleWireResponseSchema,
  contentKeyBundle: DocumentContentKeyBundleResponseSchema,
  createdAt: z.string(),
  documentKekTargets: DocumentKekTargetsResponseSchema,
  id: z.string(),
});

export type DocumentCreateResponse = z.infer<
  typeof DocumentCreateResponseSchema
>;

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
  /**
   * Present (true) when the stored content-key bundle could not be carried
   * forward to the current KEK targets — e.g. a revoke rotated a linked
   * container's key epoch. The bundle is still served so a writer that spans
   * the rotation can unwrap the content key via KEK history and heal the
   * document by syncing a re-wrapped bundle at the next content-key epoch.
   * documentKekTargets always describes the CURRENT targets.
   */
  contentKeyBundleStale?: true;
  authorizingContainerPaths: ContainerWriterProjectionResponse[];
}

/**
 * Derives the KEK-target summary that corresponds to a content-key bundle,
 * preserving the bundle's served target order. Both the API (for stale-bundle
 * read-only sync responses) and clients (for plans built against a stale
 * bundle) must derive this identically so response/plan state comparisons
 * hold byte-for-byte.
 */
export function documentKekTargetsFromContentKeyBundle(
  bundle: DocumentContentKeyBundleResponse,
): DocumentKekTargetsResponse {
  const targets = bundle.targets.map((target) => ({
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
  }));

  return {
    documentId: bundle.documentId,
    documentKeyTargetHash: bundle.targetHash,
    linkSetManifestHash: bundle.linkSetManifestHash,
    linkedContainerKeyEpochIds: targets.map(
      (target) => target.containerKeyEpochId,
    ),
    linkedContainerManifestHashes: targets.map(
      (target) => target.containerManifestHash,
    ),
    targets,
  };
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
  return DocumentCreateResponseSchema.safeParse(value).success;
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
  const contentKeyBundleStale = isPlainObject(value)
    ? Reflect.get(value, "contentKeyBundleStale")
    : undefined;

  return (
    isPlainObject(value) &&
    hasStringProperty(value, "documentId") &&
    (contentKeyBundleStale === undefined || contentKeyBundleStale === true) &&
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
