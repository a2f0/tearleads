import { z } from "zod";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyArraySchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
} from "../schema";
import {
  AccessEventBundleWireResponseSchema,
  AccessManifestBundleWireResponseSchema,
} from "../util";
import { writerProjectionManifestBundlesRefinement } from "../writerProjectionRefinements";
import {
  ContainerKeyingPathResponseSchema,
  ContainerKeyingPathWireResponseSchema,
} from "./container";
import {
  commitLsnResponseShape,
  type DocumentContentKeyBundleResponse,
  DocumentContentKeyBundleResponseSchema,
  type DocumentKekTargetsResponse,
  DocumentKekTargetsResponseSchema,
  type DocumentSyncResponse,
  DocumentSyncResponseSchema,
} from "./documentSyncSchema";
import {
  containerKeyingPathReferences,
  ManifestBundlesSchema,
  ManifestHashReferenceSchema,
  OmittedManifestBundlesSchema,
  refineManifestBundleReferences,
} from "./manifestBundleReferences";
import { ProjectionPolicyEvidenceResponseSchema } from "./projectionPolicyEvidence";

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

/**
 * What the create transaction committed of a seed: the accepted update id and
 * the commit position a following sync reads from, as a sync response reports
 * them.
 */
export const DocumentCreateSeedResponseSchema = loosePlainObject({
  acceptedOutgoingUpdateIds: arraySchema(nonEmptyStringSchema, 1),
  ...commitLsnResponseShape,
});

export type DocumentCreateSeedResponse = z.infer<
  typeof DocumentCreateSeedResponseSchema
>;

/**
 * A document create or link-set mutation acknowledges by hash: the signed
 * event's hash, the committed link-set manifest hash, the content-key epoch
 * the server stored, and the KEK target hash it resolved. It never echoes the
 * signed event, manifest, state, content-key wraps, or KEK targets; the client
 * compares each hash with the plan it signed and records state built from
 * that plan.
 */
const documentMutationAcknowledgementShape = {
  contentKeyEpoch: positiveIntegerSchema,
  eventHash: nonEmptyStringSchema,
  id: z.string(),
  manifestHash: nonEmptyStringSchema,
  targetHash: nonEmptyStringSchema,
} satisfies z.ZodRawShape;

export const DocumentCreateResponseSchema = loosePlainObject({
  ...documentMutationAcknowledgementShape,
  createdAt: z.string(),
  /** Present exactly when the request carried a seed. */
  initialSync: DocumentCreateSeedResponseSchema.optional(),
});

export type DocumentCreateResponse = z.infer<
  typeof DocumentCreateResponseSchema
>;

export const DocumentLinkSetMutationResponseSchema = loosePlainObject(
  documentMutationAcknowledgementShape,
);

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
  policyEvidence: ProjectionPolicyEvidenceResponseSchema,
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
  policyEvidence: ProjectionPolicyEvidenceResponseSchema,
  authorizingContainerPaths: nonEmptyArraySchema(
    ContainerKeyingPathResponseSchema,
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

function documentWriterProjectionReferences(projection: {
  readonly authorizingContainerPaths: unknown;
  readonly documentContainerManifestHistory: unknown;
  readonly documentManifest: unknown;
  readonly documentManifestContainerPaths: unknown;
  readonly documentManifestHistory: unknown;
}): unknown[] {
  const listed = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : [];
  return [
    projection.documentManifest,
    ...listed(projection.documentManifestHistory),
    ...listed(projection.documentContainerManifestHistory),
    ...listed(projection.documentManifestContainerPaths).flatMap(listed),
    ...listed(projection.authorizingContainerPaths).flatMap(
      containerKeyingPathReferences,
    ),
  ];
}

/** The served shape; see ContainerWriterProjectionWireResponseSchema. */
export const DocumentWriterProjectionWireResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      bundles: ManifestBundlesSchema,
      omittedBundles: OmittedManifestBundlesSchema,
      policyEvidence: ProjectionPolicyEvidenceResponseSchema,
      authorizingContainerPaths: nonEmptyArraySchema(
        ContainerKeyingPathWireResponseSchema,
      ),
      contentKeyBundle: DocumentContentKeyBundleResponseSchema,
      /** Present only when the stored content-key bundle targets stale KEKs. */
      contentKeyBundleStale: z.literal(true).optional(),
      documentContainerManifestHistory: arraySchema(
        ManifestHashReferenceSchema,
      ),
      documentId: z.string(),
      documentKekTargets: DocumentKekTargetsResponseSchema,
      documentManifest: ManifestHashReferenceSchema,
      documentManifestContainerPaths: arraySchema(
        arraySchema(ManifestHashReferenceSchema),
      ),
      documentManifestHistory: arraySchema(ManifestHashReferenceSchema),
    }).superRefine((projection, context) =>
      refineManifestBundleReferences(
        projection,
        documentWriterProjectionReferences(projection),
        context,
      ),
    ),
    [writerProjectionManifestBundlesRefinement],
  );

export type DocumentWriterProjectionWireResponse = z.infer<
  typeof DocumentWriterProjectionWireResponseSchema
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

export function isDocumentWriterProjectionWireResponse(
  value: unknown,
): value is DocumentWriterProjectionWireResponse {
  return DocumentWriterProjectionWireResponseSchema.safeParse(value).success;
}
