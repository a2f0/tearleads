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
  // The revoke removes the caller's write access on owed descendants. Another
  // authorized member must perform it; retrying with carried rekeys cannot help.
  descendantRekeysInaccessible: "container_descendant_rekeys_inaccessible",
  manifestAlreadyExists: "container_manifest_already_exists",
  // A create or move would leave a path longer than readers accept. The same
  // request never succeeds: a queued move is abandoned, while a queued create
  // keeps its intent (a later local move can re-arm it).
  pathTooDeep: "container_path_too_deep",
  stateStale: "container_mutation_state_stale",
} as const;

export const ContainerMutationBehaviorErrorCodeSchema = z.literal([
  CONTAINER_MUTATION_ERROR_CODES.ancestorRekeysRequired,
  CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired,
  CONTAINER_MUTATION_ERROR_CODES.descendantRekeysInaccessible,
  CONTAINER_MUTATION_ERROR_CODES.manifestAlreadyExists,
  CONTAINER_MUTATION_ERROR_CODES.pathTooDeep,
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
    /** Parent-first; owed levels, or the inaccessible subset on a refused revoke. */
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
