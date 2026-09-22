import { z } from "zod";
import { registerJsonSchemaView } from "../jsonSchema";
import {
  arraySchema,
  boundedNonEmptyArraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
  requiredUnknownSchema,
} from "../schema";
import {
  AccessManifestBundleWireSchema,
  ContainerKekKeyringWireRecordSchema,
  MAX_INLINE_CONTAINER_REKEYS,
  MAX_ROTATION_CONTAINER_REKEYS,
} from "../util";

const AccessManifestBundleWireArraySchema = arraySchema(
  AccessManifestBundleWireSchema,
);

const ContainerMutationKeyringSchema = registerJsonSchemaView(
  z.custom<Record<string, unknown>>(
    (value) => ContainerKekKeyringWireRecordSchema.safeParse(value).success,
  ),
  ContainerKekKeyringWireRecordSchema,
);

const containerMutationRequestShape = {
  body: requiredUnknownSchema,
  containerManifestHistory: AccessManifestBundleWireArraySchema.optional(),
  destinationParentContainerPath:
    AccessManifestBundleWireArraySchema.optional(),
  event: plainObjectSchema,
  expectedManifestHash: nonEmptyStringSchema,
  keyEpoch: plainObjectSchema,
  keyring: ContainerMutationKeyringSchema.nullable(),
  manifest: plainObjectSchema,
  parentContainerPath: AccessManifestBundleWireArraySchema.optional(),
  parentKekState: plainObjectSchema.nullable().optional(),
  predecessorBridge: plainObjectSchema.nullable(),
  previousContainerPath: AccessManifestBundleWireArraySchema.optional(),
  previousManifest: AccessManifestBundleWireSchema.nullable().optional(),
  principalPolicies: arraySchema(plainObjectSchema),
  userRecipientKeys: arraySchema(plainObjectSchema).optional(),
  wraps: arraySchema(plainObjectSchema),
};

export const ContainerMutationRequestSchema = loosePlainObject(
  containerMutationRequestShape,
);

export type ContainerMutationRequest = z.infer<
  typeof ContainerMutationRequestSchema
>;

/**
 * A rekey, revoke, or move: the rotation plus the descendant rekeys it must
 * commit with. `containerRekeys` names, parent-first, the descendants above a
 * directly granted container; they commit with the rotation or not at all.
 * Only these three routes take it, so the carriers that already hold a flat
 * rekey list (document and blob writes) stay as they are.
 */
export const ContainerRotationRequestSchema = loosePlainObject({
  ...containerMutationRequestShape,
  containerRekeys: arraySchema(
    ContainerMutationRequestSchema,
    MAX_ROTATION_CONTAINER_REKEYS,
  ).optional(),
});

export type ContainerRotationRequest = z.infer<
  typeof ContainerRotationRequestSchema
>;

export const ContainerReciteRequestSchema = loosePlainObject({
  body: requiredUnknownSchema,
  event: plainObjectSchema,
  expectedManifestHash: nonEmptyStringSchema,
  manifest: plainObjectSchema,
  previousContainerPath: boundedNonEmptyArraySchema(
    AccessManifestBundleWireSchema,
    100,
  ),
  previousManifest: AccessManifestBundleWireSchema,
  principalPolicies: arraySchema(plainObjectSchema),
});

export type ContainerReciteRequest = z.infer<
  typeof ContainerReciteRequestSchema
>;

export function isContainerReciteRequest(
  value: unknown,
): value is ContainerReciteRequest {
  return ContainerReciteRequestSchema.safeParse(value).success;
}

export function isContainerRotationRequest(
  value: unknown,
): value is ContainerRotationRequest {
  return ContainerRotationRequestSchema.safeParse(value).success;
}

export function isContainerMutationRequest(
  value: unknown,
): value is ContainerMutationRequest {
  return ContainerMutationRequestSchema.safeParse(value).success;
}

export function isOptionalContainerMutationRequestArray(
  value: unknown,
): value is ContainerMutationRequest[] | undefined {
  return arraySchema(
    ContainerMutationRequestSchema,
    MAX_INLINE_CONTAINER_REKEYS,
  )
    .optional()
    .safeParse(value).success;
}
