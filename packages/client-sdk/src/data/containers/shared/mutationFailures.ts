import type { ContainerMutationSubmitFailure } from "./types";

const STALE_PARENT_CONTAINER_PATH_PATTERN =
  /: parentContainerPath\[\d+\] manifest head is stale$/u;

export function isStaleParentContainerPathFailure(
  failure: ContainerMutationSubmitFailure,
): boolean {
  return (
    failure.status === 409 &&
    STALE_PARENT_CONTAINER_PATH_PATTERN.test(failure.message)
  );
}

// The container-with-metadata create commits the container and its metadata
// document in one transaction, so a re-submit of the same stable ids after a
// lost create response reports either the container OR its metadata document
// manifest already exists (the server surfaces whichever head it hits first).
const MANIFEST_ALREADY_EXISTS_PATTERN =
  /\b(?:Container|Document) manifest already exists\b/u;

/**
 * A create whose response was lost re-sends the same stable container (and
 * metadata document) id; the server then reports the manifest already exists.
 * That is not a failure — the first attempt committed — so the caller adopts the
 * already-committed container instead of surfacing the conflict, mirroring the
 * document create path's idempotent-retry handling.
 */
export function isContainerManifestAlreadyExistsConflict(
  failure: ContainerMutationSubmitFailure,
): boolean {
  return (
    failure.status === 409 &&
    MANIFEST_ALREADY_EXISTS_PATTERN.test(failure.message)
  );
}
