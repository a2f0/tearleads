import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";

export const CONTAINER_PATH_TOO_DEEP_MESSAGE =
  "Container path exceeds maximum depth";

/**
 * A create or move would leave a path longer than readers accept. The same
 * request never succeeds: a queued move is abandoned, and a queued create
 * waits for a local move to re-arm it.
 */
export class ContainerPathTooDeepError extends Error {
  readonly code = CONTAINER_MUTATION_ERROR_CODES.pathTooDeep;

  constructor() {
    super(CONTAINER_PATH_TOO_DEEP_MESSAGE);
    this.name = "ContainerPathTooDeepError";
  }
}

/** Refuse a container path of more than `MAX_CONTAINER_PATH_LENGTH` entries. */
export function assertContainerPathLengthFits(pathLength: number): void {
  if (pathLength > MAX_CONTAINER_PATH_LENGTH)
    throw new ContainerPathTooDeepError();
}

/** The API also checks descendants that this client may not be able to see. */
export function assertContainerChildPathFits(
  parentPath: readonly unknown[],
): void {
  assertContainerPathLengthFits(parentPath.length + 1);
}
