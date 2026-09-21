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
import {
  ancestorRekeysRequired,
  ContainerMutationError,
  mutationStateStale,
} from "../errors";

/** Events that wrap no new secret to the parent. */
const NON_MINTING_EVENT_TYPES: ReadonlySet<string> = new Set([
  "container.grant",
  "container.recite",
]);

export async function assertParentKekStateCurrent(
  executor: DatabaseTransaction,
  manifest: VerifiedContainerAccessManifest,
  parentKekState: VerifiedContainerKekState | null,
  previousManifest: VerifiedContainerAccessManifest | null = null,
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
  // A new child secret must not be wrapped through a stale intermediate. A
  // recitation mints nothing. Neither does a grant, but the FIRST direct grant
  // on a container may sit below a lazily stale chain, and its grantee could
  // never re-key the levels above its own container: the sharer, who can,
  // repairs that chain before sharing. A container that already carries a
  // grant is exempt: rotations above it must keep its chain current, so a
  // further grant, or a group rematerialization refreshing one, adds no new
  // obligation. That chain can still be stale past the carried-rekey cap, or
  // after a group rematerialization, which does not carry descendants yet;
  // refusing a second grant there would repair nothing the first did not owe.
  const isFirstGrant =
    eventType === "container.grant" &&
    (previousManifest?.state.directGrants.length ?? 0) === 0;
  if (isFirstGrant || !NON_MINTING_EVENT_TYPES.has(eventType)) {
    await resolveCurrentContainerKekTargetsMapped(
      [parentKekState.containerId],
      executor,
      // Only genuine staleness may become a refresh-and-retry instruction; an
      // integrity failure shares the 409 status but would retry forever. A
      // stale chain above a first grant is not cleared by refetching either.
      (message, status, stale) =>
        status === 409 && stale
          ? isFirstGrant
            ? ancestorRekeysRequired(message)
            : mutationStateStale(message)
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
