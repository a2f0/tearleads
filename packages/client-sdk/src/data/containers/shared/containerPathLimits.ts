import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";

/** The API also checks descendants that this client may not be able to see. */
export function assertContainerChildPathFits(
  parentPath: readonly unknown[],
): void {
  if (parentPath.length >= MAX_CONTAINER_PATH_LENGTH)
    throw new Error("Container path exceeds maximum depth");
}
