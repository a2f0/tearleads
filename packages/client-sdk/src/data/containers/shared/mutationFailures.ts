import {
  CONTAINER_MUTATION_ERROR_CODES,
  DOCUMENT_MUTATION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import type { ContainerMutationSubmitFailure } from "./types";

export function isStaleParentContainerPathFailure(
  failure: ContainerMutationSubmitFailure,
): boolean {
  return (
    failure.status === 409 &&
    (failure.code === CONTAINER_MUTATION_ERROR_CODES.stateStale ||
      failure.code === DOCUMENT_SYNC_ERROR_CODES.stateStale)
  );
}

/**
 * A create whose response was lost re-sends the same stable container (and
 * metadata document) id; the server then reports the manifest already exists.
 * The compound create can report either the container or metadata-document
 * code because both stable ids commit in the same transaction.
 * That is not a failure — the first attempt committed — so the caller adopts the
 * already-committed container instead of surfacing the conflict, mirroring the
 * document create path's idempotent-retry handling.
 */
export function isContainerManifestAlreadyExistsConflict(
  failure: ContainerMutationSubmitFailure,
): boolean {
  return (
    failure.status === 409 &&
    (failure.code === CONTAINER_MUTATION_ERROR_CODES.manifestAlreadyExists ||
      failure.code === DOCUMENT_MUTATION_ERROR_CODES.manifestAlreadyExists)
  );
}
