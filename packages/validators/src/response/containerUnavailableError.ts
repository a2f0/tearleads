/**
 * A mutation cited a container that no longer has a live `containers` row: it
 * was deleted (its manifest head is retained for history, so the reference
 * still resolves) between the client's projection fetch and the commit. The
 * container id is immutable and never comes back, so a queued intent hitting
 * this code has no retry path — unlike an uncoded 409, which may be transient.
 * Emitted by document create/link-set, container create/move, and blob bind
 * paths that resolve `*ContainerPathRefs` or full-bundle container paths.
 */
export const CONTAINER_UNAVAILABLE_ERROR_CODE = "container_unavailable";

export type ContainerUnavailableErrorCode =
  typeof CONTAINER_UNAVAILABLE_ERROR_CODE;
