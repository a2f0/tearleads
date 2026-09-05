import { z } from "zod";
import { DocumentMutationErrorCodeSchema } from "./documentMutationError";
import { PrincipalPolicyStaleErrorResponseSchema } from "./principal";

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

export const ContainerMutationFailureResponseSchema = z.union([
  z.looseObject({
    code: ContainerMutationErrorCodeSchema.optional(),
    error: z.string().min(1),
  }),
  PrincipalPolicyStaleErrorResponseSchema,
]);

export type ContainerMutationFailureResponse = z.infer<
  typeof ContainerMutationFailureResponseSchema
>;
