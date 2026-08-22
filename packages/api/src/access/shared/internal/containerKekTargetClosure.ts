import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { uniqueSortedStrings } from "../../../utils/array";
import {
  ContainerKekTargetError,
  type ContainerKekTargetStatus,
  type ContainerManifestTarget,
  loadCurrentContainerManifestTargetClosure,
} from "./containerKekTargets";

export async function listCurrentContainerKekTargetClosureIdsMapped<
  E extends Error,
>(
  containerIds: readonly string[],
  executor: DatabaseSession,
  mapError: (message: string, status: ContainerKekTargetStatus) => E,
): Promise<string[]> {
  try {
    const uniqueContainerIds = uniqueSortedStrings(containerIds);
    if (uniqueContainerIds.length === 0) {
      return [];
    }
    const targetByContainerId: Map<string, ContainerManifestTarget> =
      await loadCurrentContainerManifestTargetClosure({
        containerIds: uniqueContainerIds,
        executor,
      });
    if (
      uniqueContainerIds.some(
        (containerId) => !targetByContainerId.has(containerId),
      )
    ) {
      throw new ContainerKekTargetError("Container manifest head missing", 409);
    }
    return uniqueSortedStrings([...targetByContainerId.keys()]);
  } catch (error) {
    if (error instanceof ContainerKekTargetError) {
      throw mapError(error.message, error.status);
    }
    throw error;
  }
}
