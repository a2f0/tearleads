import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { uniqueSortedStrings } from "../../../utils/array";
import {
  ContainerKekTargetError,
  type ContainerKekTargetStatus,
  type ContainerManifestTarget,
  loadCurrentContainerManifestTargetClosure,
} from "./containerKekTargets";

function assertContainerAncestorClosureIsComplete(
  targetByContainerId: ReadonlyMap<string, ContainerManifestTarget>,
): void {
  for (const target of targetByContainerId.values()) {
    if (
      target.parentContainerId !== null &&
      !targetByContainerId.has(target.parentContainerId)
    ) {
      throw new ContainerKekTargetError(
        `Container KEK parent target is missing for container ${target.containerId} (parent: ${target.parentContainerId})`,
        409,
      );
    }
  }
}

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
    assertContainerAncestorClosureIsComplete(targetByContainerId);
    return uniqueSortedStrings([...targetByContainerId.keys()]);
  } catch (error) {
    if (error instanceof ContainerKekTargetError) {
      throw mapError(error.message, error.status);
    }
    throw error;
  }
}
