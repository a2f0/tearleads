import {
  CONTAINER_MUTATION_ERROR_CODES,
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
 * A create whose response was lost re-sends the same stable container id; the
 * server then reports that the container manifest already exists. That proves
 * the first attempt committed, so the caller can await remote hydration.
 *
 * A metadata-document conflict is deliberately excluded. The compound server
 * transaction can create the container and then roll everything back when the
 * metadata document already exists, so that code alone does not prove the
 * container exists remotely.
 */
export function isContainerManifestAlreadyExistsConflict(
  failure: ContainerMutationSubmitFailure,
): boolean {
  return (
    failure.status === 409 &&
    failure.code === CONTAINER_MUTATION_ERROR_CODES.manifestAlreadyExists
  );
}
