import { z } from "zod";
import { containerKekLogSingleKeyringRefinement } from "../containerReadRefinements";
import { ContainerSystemSlotSchema } from "../containerSystemSlot";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import { organizationProvisioningContainerKeyringRefinement } from "../organizationProvisioningRefinements";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyArraySchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  plainObjectSchema,
  positiveIntegerSchema,
  sha256HexStringSchema,
} from "../schema";
import {
  AccessManifestBundleWireResponseSchema,
  CONTAINER_KEK_LOG_PAGE_LIMIT,
  CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT,
  ContainerKekKeyringWireRecordSchema,
} from "../util";
import {
  containerWriterProjectionPathKekCountRefinement,
  writerProjectionManifestBundlesRefinement,
} from "../writerProjectionRefinements";
import { EffectiveAccessLevelSchema } from "./accessLevel";
import {
  containerKeyingPathReferences,
  ManifestBundlesSchema,
  ManifestHashReferenceSchema,
  OmittedManifestBundlesSchema,
  refineManifestBundleReferences,
} from "./manifestBundleReferences";
import { ReferencedPrincipalStateResponseSchema } from "./principalReference";
import { ProjectionPolicyEvidenceResponseSchema } from "./projectionPolicyEvidence";
import { SyncWatermarkSchema } from "./syncWatermark";

/**
 * The container's sealed predecessor key history. Opening it under the
 * current KEK yields every retained historical KEK in one decrypt; the
 * bridge log behind it is served only by the rebuild read path.
 */
const ContainerKekKeyringWireResponseSchema =
  ContainerKekKeyringWireRecordSchema;

export type ContainerKekKeyringWireResponse = z.infer<
  typeof ContainerKekKeyringWireResponseSchema
>;

const containerKekResponseShape = {
  accessManifestHash: nonEmptyStringSchema,
  containerId: z.string(),
  containerKeyEpoch: positiveIntegerSchema,
  containerKeyEpochId: nonEmptyStringSchema,
  containerManifestHistory: arraySchema(AccessManifestBundleWireResponseSchema),
  keyEpoch: plainObjectSchema,
  keyEpochHash: nonEmptyStringSchema,
  keyring: ContainerKekKeyringWireResponseSchema.nullable(),
  keyTargetHash: nonEmptyStringSchema,
  parentContainerKeyEpochId: z.string().nullable(),
  recipientTargets: nonEmptyArraySchema(plainObjectSchema),
  wraps: nonEmptyArraySchema(plainObjectSchema),
};

function refineContainerKekKeyring(
  value: { readonly containerKeyEpoch: number; readonly keyring: unknown },
  context: z.RefinementCtx,
) {
  if ((value.keyring === null) !== (value.containerKeyEpoch === 1)) {
    context.addIssue({
      code: "custom",
      message: "container keyring must be null exactly at epoch 1",
      path: ["keyring"],
    });
  }
}

const ContainerKekResponseSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject(containerKekResponseShape).superRefine(
    refineContainerKekKeyring,
  ),
  [organizationProvisioningContainerKeyringRefinement],
);

/** On the writer-projection wire, KEK history cites manifests by hash. */
const ContainerKekWireResponseSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject({
    ...containerKekResponseShape,
    containerManifestHistory: arraySchema(ManifestHashReferenceSchema),
  }).superRefine(refineContainerKekKeyring),
  [organizationProvisioningContainerKeyringRefinement],
);

export type ContainerKekResponse = z.infer<typeof ContainerKekResponseSchema>;

/** One KEK level as served in full, its manifest history cited by hash. */
export type ContainerKekWireLevel = z.infer<
  typeof ContainerKekWireResponseSchema
>;

export function isContainerKekWireLevel(
  value: unknown,
): value is ContainerKekWireLevel {
  return (
    ContainerKekWireResponseSchema.safeParse(value).success &&
    !Object.hasOwn(Object(value), "levelDigest")
  );
}

/**
 * A KEK level the request declared held (`k:` hint), replaced by the digest
 * of its canonical wire bytes. It keeps the level's manifest citations, so
 * the response's bundle bookkeeping stays exact; the client refills the
 * level from those exact held bytes before anything reads it.
 */
export const CitedContainerKekLevelSchema = z.strictObject({
  levelDigest: sha256HexStringSchema,
  containerManifestHistory: arraySchema(ManifestHashReferenceSchema),
});

export type CitedContainerKekLevel = z.infer<
  typeof CitedContainerKekLevelSchema
>;

export function isCitedContainerKekLevel(
  value: unknown,
): value is CitedContainerKekLevel {
  return CitedContainerKekLevelSchema.safeParse(value).success;
}

const ServedContainerKekLevelSchema = z.union([
  CitedContainerKekLevelSchema,
  ContainerKekWireResponseSchema,
]);

/**
 * The append-only rotation log for one container: every epoch with its
 * write-once bridge and sealed keyring. This is the rebuild/repair read
 * path — hot reads use the projection keyring instead.
 */
export const ContainerKekLogEpochResponseSchema = loosePlainObject({
  accessManifestHash: nonEmptyStringSchema,
  bridge: plainObjectSchema.nullable(),
  containerKeyEpoch: positiveIntegerSchema,
  containerKeyEpochId: nonEmptyStringSchema,
  keyring: ContainerKekKeyringWireResponseSchema.nullable(),
  parentContainerKeyEpochId: z.string().nullable(),
  /**
   * Retained recipient envelopes are the recovery backstop when a bridge is
   * severed. The server and response guard apply this bound per epoch.
   */
  wraps: arraySchema(plainObjectSchema, CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT),
});

export type ContainerKekLogEpochResponse = z.infer<
  typeof ContainerKekLogEpochResponseSchema
>;

export const ContainerKekLogResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      containerId: nonEmptyStringSchema,
      epochs: arraySchema(
        ContainerKekLogEpochResponseSchema,
        CONTAINER_KEK_LOG_PAGE_LIMIT,
      ),
      /** True when epochs above this page's last remain unserved. */
      hasMore: z.boolean(),
    }).superRefine(({ epochs }, context) => {
      if (epochs.filter((epoch) => epoch.keyring !== null).length > 1) {
        context.addIssue({
          code: "custom",
          message: "container KEK log pages contain at most one keyring",
          path: ["epochs"],
        });
      }
    }),
    [containerKekLogSingleKeyringRefinement],
  );

export type ContainerKekLogResponse = z.infer<
  typeof ContainerKekLogResponseSchema
>;

export function isContainerKekLogResponse(
  value: unknown,
): value is ContainerKekLogResponse {
  return ContainerKekLogResponseSchema.safeParse(value).success;
}

/**
 * A container mutation's acknowledgement names what the server committed by
 * hash and adds only the fields it assigned (timestamps). The client compares
 * the hashes with its own signed plan and persists state built from the plan,
 * so the signed event, manifest, state, key epoch, and wraps are never echoed.
 */
const ContainerManifestMutationResponseShape = {
  containerId: z.string(),
  createdAt: z.string(),
  eventHash: nonEmptyStringSchema,
  manifestHead: loosePlainObject({
    epoch: z.number(),
    manifestHash: z.string(),
  }),
  organizationId: z.string(),
  parentId: z.string().nullable(),
  systemSlot: ContainerSystemSlotSchema.nullable().optional(),
  updatedAt: z.string(),
};

/** The committed key epoch, by hash: no epoch, wrap, or keyring bytes. */
const ContainerMutationKekAcknowledgementSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      containerKeyEpoch: positiveIntegerSchema,
      containerKeyEpochId: nonEmptyStringSchema,
      keyEpochHash: nonEmptyStringSchema,
      keyringHash: nonEmptyStringSchema.nullable(),
      keyTargetHash: nonEmptyStringSchema,
      parentContainerKeyEpochId: z.string().nullable(),
    }).superRefine((value, context) => {
      if ((value.keyringHash === null) !== (value.containerKeyEpoch === 1)) {
        context.addIssue({
          code: "custom",
          message: "container keyring hash must be null exactly at epoch 1",
          path: ["keyringHash"],
        });
      }
    }),
    [organizationProvisioningContainerKeyringRefinement],
  );

const containerMutationResponseShape = {
  ...ContainerManifestMutationResponseShape,
  containerKek: ContainerMutationKekAcknowledgementSchema,
};

export const ContainerMutationResponseSchema = loosePlainObject(
  containerMutationResponseShape,
);

export type ContainerMutationResponse = z.infer<
  typeof ContainerMutationResponseSchema
>;

/** A rotation's acknowledgement, plus one per carried rekey in request order. */
export const ContainerRotationResponseSchema = loosePlainObject({
  ...containerMutationResponseShape,
  containerRekeys: arraySchema(ContainerMutationResponseSchema).optional(),
});

export type ContainerRotationResponse = z.infer<
  typeof ContainerRotationResponseSchema
>;

export function isContainerRotationResponse(
  value: unknown,
): value is ContainerRotationResponse {
  return ContainerRotationResponseSchema.safeParse(value).success;
}

export const ContainerReciteResponseSchema = loosePlainObject(
  ContainerManifestMutationResponseShape,
);
export type ContainerReciteResponse = z.infer<
  typeof ContainerReciteResponseSchema
>;

export function isContainerReciteResponse(
  value: unknown,
): value is ContainerReciteResponse {
  return ContainerReciteResponseSchema.safeParse(value).success;
}

export const ContainerDeleteResponseSchema = loosePlainObject({
  containerId: z.string(),
  deletedAt: z.string(),
});

export type ContainerDeleteResponse = z.infer<
  typeof ContainerDeleteResponseSchema
>;

export const CONTAINER_PROJECTION_STATE_INVALID_ERROR_CODE =
  "container_projection_state_invalid";
export const ContainerWriterProjectionErrorResponseSchema = loosePlainObject({
  code: z.literal(CONTAINER_PROJECTION_STATE_INVALID_ERROR_CODE),
  error: z.string(),
});

const containerKeyingPathShape = {
  containerId: z.string(),
  containerKeks: arraySchema(ContainerKekResponseSchema),
  organizationId: z.string(),
  path: nonEmptyArraySchema(AccessManifestBundleWireResponseSchema),
};
function refineContainerKeyingPath(
  projection: { containerKeks: unknown[]; path: unknown[] },
  context: z.RefinementCtx,
) {
  // loosePlainObject can continue refinements after reporting malformed fields.
  if (
    Array.isArray(projection.containerKeks) &&
    Array.isArray(projection.path) &&
    projection.containerKeks.length !== projection.path.length
  )
    context.addIssue({
      code: "custom",
      message: "container KEK count must match the manifest path length",
      path: ["containerKeks"],
    });
}
export const ContainerKeyingPathResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject(containerKeyingPathShape).superRefine(
      refineContainerKeyingPath,
    ),
    [containerWriterProjectionPathKekCountRefinement],
  );
export type ContainerKeyingPathResponse = z.infer<
  typeof ContainerKeyingPathResponseSchema
>;
/**
 * The decoded projection a client verifies: every manifest position holds
 * its bundle. `decodeContainerWriterProjection` builds it from the wire.
 */
export const ContainerWriterProjectionResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      ...containerKeyingPathShape,
      policyEvidence: ProjectionPolicyEvidenceResponseSchema,
    }).superRefine(refineContainerKeyingPath),
    [containerWriterProjectionPathKekCountRefinement],
  );

export type ContainerWriterProjectionResponse = z.infer<
  typeof ContainerWriterProjectionResponseSchema
>;

const containerKeyingPathWireShape = {
  containerId: z.string(),
  containerKeks: arraySchema(ServedContainerKekLevelSchema),
  organizationId: z.string(),
  path: nonEmptyArraySchema(ManifestHashReferenceSchema),
};
export const ContainerKeyingPathWireResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject(containerKeyingPathWireShape).superRefine(
      refineContainerKeyingPath,
    ),
    [containerWriterProjectionPathKekCountRefinement],
  );
export type ContainerKeyingPathWireResponse = z.infer<
  typeof ContainerKeyingPathWireResponseSchema
>;

/**
 * The served shape: manifest positions cite `bundles` by hash, except hashes
 * the request declared already held, which `omittedBundles` lists instead.
 */
export const ContainerWriterProjectionWireResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      bundles: ManifestBundlesSchema,
      omittedBundles: OmittedManifestBundlesSchema,
      ...containerKeyingPathWireShape,
      policyEvidence: ProjectionPolicyEvidenceResponseSchema,
    }).superRefine((projection, context) => {
      refineContainerKeyingPath(projection, context);
      refineManifestBundleReferences(
        projection,
        containerKeyingPathReferences(projection),
        context,
      );
    }),
    [
      containerWriterProjectionPathKekCountRefinement,
      writerProjectionManifestBundlesRefinement,
    ],
  );

export type ContainerWriterProjectionWireResponse = z.infer<
  typeof ContainerWriterProjectionWireResponseSchema
>;

export const ContainerSummaryResponseSchema = loosePlainObject({
  createdAt: z.string(),
  depth: nonNegativeIntegerSchema,
  effectiveAccessLevel: EffectiveAccessLevelSchema,
  id: z.string(),
  metadataAccessEpoch: z.number(),
  metadataAccessStateHash: nonEmptyStringSchema,
  metadataDocumentId: z.string(),
  metadataReferencedPrincipals: arraySchema(
    ReferencedPrincipalStateResponseSchema,
  ),
  organizationId: z.string(),
  parentId: z.string().nullable(),
  systemSlot: ContainerSystemSlotSchema.nullable().optional(),
  updatedAt: z.string(),
});

export type ContainerSummary = z.infer<typeof ContainerSummaryResponseSchema>;

export const ContainerSyncTombstoneResponseSchema = loosePlainObject({
  containerId: z.string(),
  depth: nonNegativeIntegerSchema,
  parentId: z.string().nullable(),
  reason: z.literal(["access_revoked", "deleted"]),
  updatedAt: z.string(),
});

export type ContainerSyncTombstone = z.infer<
  typeof ContainerSyncTombstoneResponseSchema
>;

export const ListContainersResponseSchema = loosePlainObject({
  hasMore: z.boolean(),
  items: arraySchema(ContainerSummaryResponseSchema),
  nextWatermark: SyncWatermarkSchema.nullable(),
  tombstones: arraySchema(ContainerSyncTombstoneResponseSchema),
});

export type ListContainersResponse = z.infer<
  typeof ListContainersResponseSchema
>;

export function isListContainersResponse(
  value: unknown,
): value is ListContainersResponse {
  return ListContainersResponseSchema.safeParse(value).success;
}

export function isContainerMutationResponse(
  value: unknown,
): value is ContainerMutationResponse {
  return ContainerMutationResponseSchema.safeParse(value).success;
}

export function isContainerDeleteResponse(
  value: unknown,
): value is ContainerDeleteResponse {
  return ContainerDeleteResponseSchema.safeParse(value).success;
}

export function isContainerWriterProjectionResponse(
  value: unknown,
): value is ContainerWriterProjectionResponse {
  return ContainerWriterProjectionResponseSchema.safeParse(value).success;
}

export function isContainerWriterProjectionWireResponse(
  value: unknown,
): value is ContainerWriterProjectionWireResponse {
  return ContainerWriterProjectionWireResponseSchema.safeParse(value).success;
}
