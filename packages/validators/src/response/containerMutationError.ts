import { z } from "zod";
import { arraySchema, nonEmptyStringSchema } from "../schema";
import { MAX_ROTATION_CONTAINER_REKEYS } from "../util";
import { CONTAINER_UNAVAILABLE_ERROR_CODE } from "./containerUnavailableError";
import { CONTAINER_DESCENDANT_REKEYS_REQUIRED_ERROR_CODE } from "./descendantRekeysRequiredError";
import { DocumentMutationErrorCodeSchema } from "./documentMutationError";
import { PrincipalPolicyStaleErrorResponseSchema } from "./principal";

export const CONTAINER_MUTATION_ERROR_CODES = {
  // Same literal as DOCUMENT_MUTATION_ERROR_CODES.containerUnavailable; the
  // envelope schema below already admits it through the document union.
  // A first direct grant sits below a chain pinned to a retired epoch, which
  // its grantee could never re-key. Not `stateStale`: refetching will not help,
  // the sharer must re-key that chain first.
  ancestorRekeysRequired: "container_ancestor_rekeys_required",
  containerUnavailable: CONTAINER_UNAVAILABLE_ERROR_CODE,
  // A rotation left a descendant above a granted container pinned to a retired
  // epoch. Not `stateStale`: refetching will not help, the client must sign and
  // carry the re-keys `requiredContainerIds` names.
  descendantRekeysRequired: CONTAINER_DESCENDANT_REKEYS_REQUIRED_ERROR_CODE,
  manifestAlreadyExists: "container_manifest_already_exists",
  stateStale: "container_mutation_state_stale",
} as const;

export const ContainerMutationBehaviorErrorCodeSchema = z.literal([
  CONTAINER_MUTATION_ERROR_CODES.ancestorRekeysRequired,
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
    requiredContainerIds: arraySchema(
      nonEmptyStringSchema,
      MAX_ROTATION_CONTAINER_REKEYS,
    ).optional(),
  }),
  PrincipalPolicyStaleErrorResponseSchema,
]);

export type ContainerMutationFailureResponse = z.infer<
  typeof ContainerMutationFailureResponseSchema
>;
