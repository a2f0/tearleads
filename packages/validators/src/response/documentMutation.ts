import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyArraySchema,
  nonEmptyStringSchema,
} from "../schema";
import {
  AccessEventBundleWireResponseSchema,
  AccessManifestBundleWireResponseSchema,
} from "../util";
import { ContainerWriterProjectionResponseSchema } from "./container";
import {
  type DocumentContentKeyBundleResponse,
  DocumentContentKeyBundleResponseSchema,
  type DocumentKekTargetsResponse,
  DocumentKekTargetsResponseSchema,
  type DocumentSyncResponse,
  DocumentSyncResponseSchema,
} from "./documentSyncSchema";
import { PrincipalPolicySnapshotResponseSchema } from "./principal";

export {
  type DocumentContentKeyBundleResponse,
  DocumentContentKeyBundleResponseSchema,
  type DocumentContentKeyTargetEnvelopeResponse,
  DocumentContentKeyTargetEnvelopeResponseSchema,
  type DocumentKekTargetsResponse,
  DocumentKekTargetsResponseSchema,
  type DocumentSyncPullPageResponse,
  DocumentSyncPullPageResponseSchema,
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

export const DocumentLinkSetMutationResponseSchema = loosePlainObject({
  accessManifest: AccessManifestBundleWireResponseSchema,
  contentKeyBundle: DocumentContentKeyBundleResponseSchema,
  documentKekTargets: DocumentKekTargetsResponseSchema,
  id: z.string(),
});

export type DocumentLinkSetMutationResponse = z.infer<
  typeof DocumentLinkSetMutationResponseSchema
>;

const documentPurgeProofShape = {
  authorizingContainerPath: nonEmptyArraySchema(
    AccessManifestBundleWireResponseSchema,
  ),
  documentContainerManifestHistory: arraySchema(
    AccessManifestBundleWireResponseSchema,
  ),
  documentId: nonEmptyStringSchema,
  documentManifest: AccessManifestBundleWireResponseSchema,
  documentManifestContainerPaths: arraySchema(
    arraySchema(AccessManifestBundleWireResponseSchema),
  ),
  documentManifestPredecessors: arraySchema(
    AccessManifestBundleWireResponseSchema,
  ),
  purgeEvent: AccessEventBundleWireResponseSchema,
  purgedAt: nonEmptyStringSchema,
  principalPolicySnapshots: arraySchema(PrincipalPolicySnapshotResponseSchema),
} as const;

export const DocumentPurgeProofResponseSchema = loosePlainObject(
  documentPurgeProofShape,
);

export type DocumentPurgeProofResponse = z.infer<
  typeof DocumentPurgeProofResponseSchema
>;

export const DocumentPurgeResponseSchema = loosePlainObject({
  ...documentPurgeProofShape,
  reclaimedBlobStorageKeys: arraySchema(z.string()),
});

export type DocumentPurgeResponse = z.infer<typeof DocumentPurgeResponseSchema>;

export const DocumentWriterProjectionResponseSchema = loosePlainObject({
  authorizingContainerPaths: nonEmptyArraySchema(
    ContainerWriterProjectionResponseSchema,
  ),
  contentKeyBundle: DocumentContentKeyBundleResponseSchema,
  /** Present only when the stored content-key bundle targets stale KEKs. */
  contentKeyBundleStale: z.literal(true).optional(),
  documentContainerManifestHistory: arraySchema(
    AccessManifestBundleWireResponseSchema,
  ),
  documentId: z.string(),
  documentKekTargets: DocumentKekTargetsResponseSchema,
  documentManifest: AccessManifestBundleWireResponseSchema,
  documentManifestContainerPaths: arraySchema(
    arraySchema(AccessManifestBundleWireResponseSchema),
  ),
  documentManifestHistory: arraySchema(AccessManifestBundleWireResponseSchema),
});

export type DocumentWriterProjectionResponse = z.infer<
  typeof DocumentWriterProjectionResponseSchema
>;

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
  return DocumentLinkSetMutationResponseSchema.safeParse(value).success;
}

export function isDocumentPurgeResponse(
  value: unknown,
): value is DocumentPurgeResponse {
  return DocumentPurgeResponseSchema.safeParse(value).success;
}

export function isDocumentPurgeProofResponse(
  value: unknown,
): value is DocumentPurgeProofResponse {
  return DocumentPurgeProofResponseSchema.safeParse(value).success;
}

export function isDocumentSyncResponse(
  value: unknown,
): value is DocumentSyncResponse {
  return DocumentSyncResponseSchema.safeParse(value).success;
}

export function isDocumentWriterProjectionResponse(
  value: unknown,
): value is DocumentWriterProjectionResponse {
  return DocumentWriterProjectionResponseSchema.safeParse(value).success;
}
