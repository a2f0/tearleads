import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  computeContainerKeyEpochHash,
  type VerifiedContainerAccessManifest,
  type VerifiedContainerKekState,
} from "@tearleads/crypto";
import {
  getCurrentContainerKeyEpoch,
  toContainerKeyEpoch,
} from "../../../../access/read/containerKekStore";
import { resolveCurrentContainerKekTargetsMapped } from "../../../../access/read/containerKekTargets";
import { canonicalJsonEquals } from "../../../../utils/canonicalJson";
import { ContainerMutationError, mutationStateStale } from "../errors";

export async function assertParentKekStateCurrent(
  executor: DatabaseTransaction,
  manifest: VerifiedContainerAccessManifest,
  parentKekState: VerifiedContainerKekState | null,
): Promise<void> {
  if (!manifest.state.parentContainerId) {
    return;
  }

  if (!parentKekState) {
    throw new ContainerMutationError("Parent KEK state is required", 409);
  }

  if (parentKekState.containerId !== manifest.state.parentContainerId) {
    throw new ContainerMutationError(
      "Parent KEK state container mismatch",
      409,
    );
  }

  const eventType = manifest.event.event.eventType;
  if (eventType !== "container.grant" && eventType !== "container.recite") {
    // A new child secret must not be wrapped through a stale intermediate.
    await resolveCurrentContainerKekTargetsMapped(
      [parentKekState.containerId],
      executor,
      (message, status) =>
        status === 409
          ? mutationStateStale(message)
          : new ContainerMutationError(message, status),
    );
  }

  const currentParentEpoch = await getCurrentContainerKeyEpoch(
    parentKekState.containerId,
    executor,
  );
  if (!currentParentEpoch) {
    throw new ContainerMutationError("Parent KEK state missing", 404);
  }

  const currentParentKeyEpoch = toContainerKeyEpoch(currentParentEpoch);
  const currentParentKeyEpochHash = await computeContainerKeyEpochHash(
    currentParentKeyEpoch,
  );

  if (
    parentKekState.containerKeyEpochId !== currentParentKeyEpoch.id ||
    parentKekState.keyEpochHash !== currentParentKeyEpochHash ||
    !canonicalJsonEquals(parentKekState.keyEpoch, currentParentKeyEpoch)
  ) {
    throw mutationStateStale("Parent KEK state is stale");
  }
}
