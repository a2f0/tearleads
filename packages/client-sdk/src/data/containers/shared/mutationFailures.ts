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
