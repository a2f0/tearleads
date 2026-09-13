import {
  CONTAINER_MUTATION_ERROR_CODES,
  CONTAINER_NOT_FOUND_ERROR_CODE,
  CONTAINER_UNAVAILABLE_ERROR_CODE,
  DOCUMENT_SYNC_ERROR_CODES,
} from "@tearleads/validators/response";
import type { ContainerMutationSubmitFailure } from "./types";

interface ContainerBehaviorFailure {
  readonly code?: string | undefined;
  readonly status: number | null;
}

export function isContainerNotFoundFailure(
  failure: ContainerBehaviorFailure,
): boolean {
  return (
    failure.status === 404 && failure.code === CONTAINER_NOT_FOUND_ERROR_CODE
  );
}

/**
 * A mutation cited a container path element whose live row is gone: the
 * server retained its manifest head (so the reference resolved) but the
 * container was deleted before the commit. Container ids are immutable, so
 * this never heals by retrying the same request.
 */
export function isContainerUnavailableFailure(
  failure: ContainerBehaviorFailure,
): boolean {
  return (
    failure.status === 409 && failure.code === CONTAINER_UNAVAILABLE_ERROR_CODE
  );
}

/**
 * Both server-verified proofs that a cited container no longer exists: the
 * coded projection 404 (fetched before the mutation) and the coded commit 409
 * (the container vanished between fetch and commit). Uncoded 404s and 409s
 * are excluded on purpose — they may be transient.
 */
export function isVanishedContainerFailure(
  failure: ContainerBehaviorFailure,
): boolean {
  return (
    isContainerNotFoundFailure(failure) ||
    isContainerUnavailableFailure(failure)
  );
}

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
