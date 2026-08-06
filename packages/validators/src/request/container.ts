import { z } from "zod";
import { registerJsonSchemaView } from "../jsonSchema";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
  requiredUnknownSchema,
} from "../schema";
import {
  AccessManifestBundleWireSchema,
  ContainerKekKeyringWireRecordSchema,
  MAX_INLINE_CONTAINER_REKEYS,
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

export const ContainerMutationRequestSchema = loosePlainObject({
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
});

export type ContainerMutationRequest = z.infer<
  typeof ContainerMutationRequestSchema
>;

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
