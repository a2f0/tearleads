import { z } from "zod";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaView,
  toJsonSchema,
} from "../jsonSchema";
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

const ReciteContainerPathSchema = arraySchema(
  AccessManifestBundleWireSchema,
  100,
);

export const ContainerReciteRequestSchema = loosePlainObject({
  body: requiredUnknownSchema,
  event: plainObjectSchema,
  expectedManifestHash: nonEmptyStringSchema,
  manifest: plainObjectSchema,
  previousContainerPath: registerJsonSchemaFragment(
    ReciteContainerPathSchema.refine(
      (path) => path.length > 0,
      "Recitation requires a non-empty authorization path",
    ),
    { ...toJsonSchema(ReciteContainerPathSchema), minItems: 1 },
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
