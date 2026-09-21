import { z } from "zod";
import { CONTAINER_UNAVAILABLE_ERROR_CODE } from "./containerUnavailableError";
import { DocumentMutationErrorCodeSchema } from "./documentMutationError";
import { PrincipalPolicyStaleErrorResponseSchema } from "./principal";

export const CONTAINER_MUTATION_ERROR_CODES = {
  // Same literal as DOCUMENT_MUTATION_ERROR_CODES.containerUnavailable; the
  // envelope schema below already admits it through the document union.
  containerUnavailable: CONTAINER_UNAVAILABLE_ERROR_CODE,
  // A rotation left a descendant above a granted container pinned to a retired
  // epoch. Not `stateStale`: refetching will not help, the client must sign and
  // carry the re-keys `requiredContainerIds` names.
  descendantRekeysRequired: "container_descendant_rekeys_required",
  manifestAlreadyExists: "container_manifest_already_exists",
  stateStale: "container_mutation_state_stale",
} as const;

export const ContainerMutationBehaviorErrorCodeSchema = z.literal([
  CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired,
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
    /** Parent-first; present with `descendantRekeysRequired`. */
    requiredContainerIds: z.array(z.string()).optional(),
  }),
  PrincipalPolicyStaleErrorResponseSchema,
]);

export type ContainerMutationFailureResponse = z.infer<
  typeof ContainerMutationFailureResponseSchema
>;
