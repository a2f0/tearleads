import { z } from "zod";
import { arraySchema } from "../schema";
import { DocumentMutationErrorCodeSchema } from "./documentMutationError";
import { PrincipalPolicyBundleResponseSchema } from "./principal";

export const CONTAINER_MUTATION_ERROR_CODES = {
  manifestAlreadyExists: "container_manifest_already_exists",
  stateStale: "container_mutation_state_stale",
} as const;

export const ContainerMutationBehaviorErrorCodeSchema = z.literal([
  CONTAINER_MUTATION_ERROR_CODES.manifestAlreadyExists,
  CONTAINER_MUTATION_ERROR_CODES.stateStale,
]);

export const ContainerMutationErrorCodeSchema = z.union([
  ContainerMutationBehaviorErrorCodeSchema,
  // The compound container-plus-metadata-document create can fail in either
  // half of its transaction, so its envelope preserves document-domain tags.
  DocumentMutationErrorCodeSchema,
]);

export type ContainerMutationErrorCode = z.infer<
  typeof ContainerMutationErrorCodeSchema
>;

export const ContainerMutationFailureResponseSchema = z.looseObject({
  code: z
    .union([
      ContainerMutationErrorCodeSchema,
      z.literal("principal_policy_stale"),
    ])
    .optional(),
  error: z.string().min(1),
  // Only `principal_policy_stale` activates repair, and the dedicated
  // PrincipalPolicyStaleErrorResponse guard still requires this field. Keeping
  // the operation envelope object-shaped preserves its backward-compatible
  // required `error` property in OpenAPI.
  principalPolicies: arraySchema(
    PrincipalPolicyBundleResponseSchema,
  ).optional(),
});

export type ContainerMutationFailureResponse = z.infer<
  typeof ContainerMutationFailureResponseSchema
>;
