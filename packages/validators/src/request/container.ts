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
  ContainerKekKeyringWireRecordSchema,
  MAX_INLINE_CONTAINER_REKEYS,
  MAX_ROTATION_CONTAINER_REKEYS,
} from "../util";
import {
  ContainerKekParentRefSchema,
  ContainerManifestPathSchema,
  ContainerManifestRefListSchema,
  ContainerManifestRefSchema,
  OptionalContainerManifestPathSchema,
} from "./containerManifestRef";
import { PrincipalPolicyRefListSchema } from "./principalPolicyRef";

const ContainerMutationKeyringSchema = registerJsonSchemaView(
  z.custom<Record<string, unknown>>(
    (value) => ContainerKekKeyringWireRecordSchema.safeParse(value).success,
  ),
  ContainerKekKeyringWireRecordSchema,
);

// Every manifest a mutation cites that the server already stores travels as a
// {containerId, manifestHash} reference. The server resolves each one from its
// own verified store (or from an earlier mutation of the same batch) and pins
// paths and the previous manifest to current heads; the signed event binds the
// same hashes as its dependencies, so no request copy of a stored bundle is
// ever needed. Only the new manifest this mutation commits travels in full.
// Principal policies are cited the same way, by head (see
// `PrincipalPolicyRefSchema`).
const containerMutationRequestShape = {
  body: requiredUnknownSchema,
  containerManifestHistoryRefs: ContainerManifestRefListSchema.optional(),
  destinationParentContainerPathRefs:
    OptionalContainerManifestPathSchema.optional(),
  event: plainObjectSchema,
  expectedManifestHash: nonEmptyStringSchema,
  keyEpoch: plainObjectSchema,
  keyring: ContainerMutationKeyringSchema.nullable(),
  manifest: plainObjectSchema,
  parentContainerPathRefs: OptionalContainerManifestPathSchema.optional(),
  parentKekRef: ContainerKekParentRefSchema.nullable().optional(),
  predecessorBridge: plainObjectSchema.nullable(),
  previousContainerPathRefs: OptionalContainerManifestPathSchema.optional(),
  previousManifestRef: ContainerManifestRefSchema.nullable().optional(),
  principalPolicyRefs: PrincipalPolicyRefListSchema,
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
  previousContainerPathRefs: ContainerManifestPathSchema,
  previousManifestRef: ContainerManifestRefSchema,
  principalPolicyRefs: PrincipalPolicyRefListSchema,
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
