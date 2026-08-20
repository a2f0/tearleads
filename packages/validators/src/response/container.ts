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
} from "../schema";
import {
  AccessManifestBundleWireResponseSchema,
  CONTAINER_KEK_LOG_PAGE_LIMIT,
  CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT,
  ContainerKekKeyringWireRecordSchema,
} from "../util";
import { containerWriterProjectionPathKekCountRefinement } from "../writerProjectionRefinements";
import { EffectiveAccessLevelSchema } from "./accessLevel";
import {
  ReferencedPrincipalStateResponseSchema,
  ReferencedPrincipalStateResponseShape,
} from "./principalReference";
import { SyncWatermarkSchema } from "./syncWatermark";

const ContainerGrantPrincipalStateResponseSchema = loosePlainObject({
  ...ReferencedPrincipalStateResponseShape,
  principalType: z.literal("group"),
});

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

export const ContainerKekResponseSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject(containerKekResponseShape).superRefine((value, context) => {
    if ((value.keyring === null) !== (value.containerKeyEpoch === 1)) {
      context.addIssue({
        code: "custom",
        message: "container keyring must be null exactly at epoch 1",
        path: ["keyring"],
      });
    }
  }),
  [organizationProvisioningContainerKeyringRefinement],
);

export type ContainerKekResponse = z.infer<typeof ContainerKekResponseSchema>;

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

export const ContainerMutationResponseSchema = loosePlainObject({
  accessManifest: AccessManifestBundleWireResponseSchema,
  containerId: z.string(),
  containerKek: ContainerKekResponseSchema,
  createdAt: z.string(),
  manifestHead: loosePlainObject({
    epoch: z.number(),
    manifestHash: z.string(),
  }),
  organizationId: z.string(),
  parentId: z.string().nullable(),
  referencedPrincipalHeads: arraySchema(
    ContainerGrantPrincipalStateResponseSchema,
  ),
  systemSlot: ContainerSystemSlotSchema.nullable().optional(),
  updatedAt: z.string(),
});

export type ContainerMutationResponse = z.infer<
  typeof ContainerMutationResponseSchema
>;

export const ContainerDeleteResponseSchema = loosePlainObject({
  containerId: z.string(),
  deletedAt: z.string(),
});

export type ContainerDeleteResponse = z.infer<
  typeof ContainerDeleteResponseSchema
>;

export const ContainerWriterProjectionResponseSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      containerId: z.string(),
      containerKeks: arraySchema(ContainerKekResponseSchema),
      organizationId: z.string(),
      path: nonEmptyArraySchema(AccessManifestBundleWireResponseSchema),
    }).superRefine((projection, context) => {
      if (
        Array.isArray(projection.containerKeks) &&
        Array.isArray(projection.path) &&
        projection.containerKeks.length !== projection.path.length
      ) {
        context.addIssue({
          code: "custom",
          message: "container KEK count must match the manifest path length",
          path: ["containerKeks"],
        });
      }
    }),
    [containerWriterProjectionPathKekCountRefinement],
  );

export type ContainerWriterProjectionResponse = z.infer<
  typeof ContainerWriterProjectionResponseSchema
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
