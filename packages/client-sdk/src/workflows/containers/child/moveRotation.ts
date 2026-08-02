import type {
  ContainerKekKeyring,
  ContainerKekKeyringEntry,
  ContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import {
  createContainerKekPredecessorBridge,
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
  sealContainerKekKeyring,
  verifyContainerKekKeyringEntry,
} from "@tearleads/crypto";
import type { ContainerKekResponse } from "@tearleads/validators/response";
import { resolveContainerKekEpochId } from "../../../data/containers/shared/events";
import { manifestHistoryEpochIds } from "../../../data/documents/shared/containerKekPathHistory";

/**
 * A rotation must never launder history it did not verify: an
 * authenticated-but-poisoned keyring (sealed by a prior authorized writer
 * with wrong material) would otherwise be re-signed under the honest
 * rotator's event. Every entry is checked against the material-id its
 * ordinal commits to before it is sealed forward; entry i is key epoch
 * i + 1.
 */
export async function verifyKeyringEntriesForSeal(
  containerId: string,
  entries: readonly ContainerKekKeyringEntry[],
  /**
   * The KEK the entries were opened from. When given, entries are also
   * anchored to the epoch ids its signed history commits to — a
   * self-consistent forgery passes the material check but cannot survive
   * this, so an honest rotation never re-signs one.
   */
  currentKek?: ContainerKekResponse | undefined,
): Promise<void> {
  await Promise.all(
    entries.map((entry, ordinal) =>
      verifyContainerKekKeyringEntry({
        containerId,
        entry,
        keyEpoch: ordinal + 1,
      }),
    ),
  );
  if (!currentKek) {
    return;
  }
  const entryIds = new Set(entries.map((entry) => entry.containerKeyEpochId));
  for (const historicalId of manifestHistoryEpochIds(currentKek)) {
    if (!entryIds.has(historicalId)) {
      throw new Error(
        "Container KEK keyring omits an epoch its manifest history commits to",
      );
    }
  }
}

/**
 * Re-seals the container's key history for a rotation: the previous
 * keyring's entries plus the retiring key, under the new epoch's key. One
 * decrypt and one seal regardless of container age.
 */
export async function sealRotationKeyring(input: {
  containerId: string;
  currentKek: ContainerKekResponse;
  currentKeyMaterial: Uint8Array;
  keyEpoch: number;
  successorContainerKey: Uint8Array;
  successorContainerKeyEpochId: string;
}): Promise<ContainerKekKeyring> {
  const previousEntries = input.currentKek.keyring
    ? await openContainerKekKeyring({
        keyEpoch: input.currentKek.containerKeyEpoch,
        keyring: normalizeContainerKekKeyring(input.currentKek.keyring),
        successorContainerKey: input.currentKeyMaterial,
      })
    : [];
  await verifyKeyringEntriesForSeal(
    input.containerId,
    previousEntries,
    input.currentKek,
  );
  return sealContainerKekKeyring({
    containerId: input.containerId,
    entries: [
      ...previousEntries,
      {
        containerKeyEpochId: input.currentKek.containerKeyEpochId,
        keyMaterial: input.currentKeyMaterial,
      },
    ],
    keyEpoch: input.keyEpoch,
    successorContainerKey: input.successorContainerKey,
    successorContainerKeyEpochId: input.successorContainerKeyEpochId,
  });
}

/**
 * Mints one container KEK rotation: fresh entropy for the new epoch, the
 * write-once bridge to the retiring epoch, and the re-sealed keyring.
 */
export async function buildContainerRotationArtifacts(input: {
  containerId: string;
  currentKek: ContainerKekResponse;
  currentKeyMaterial: Uint8Array;
  keyEpoch: number;
  override?: string | undefined;
}): Promise<{
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  keyring: ContainerKekKeyring;
  predecessorBridge: ContainerKekPredecessorBridge;
}> {
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await resolveContainerKekEpochId({
    containerId: input.containerId,
    keyEpoch: input.keyEpoch,
    keyMaterial: containerKey,
    override: input.override,
  });
  const predecessorBridge = await createContainerKekPredecessorBridge({
    containerId: input.containerId,
    predecessorContainerKey: input.currentKeyMaterial,
    predecessorContainerKeyEpochId: input.currentKek.containerKeyEpochId,
    successorContainerKey: containerKey,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const keyring = await sealRotationKeyring({
    containerId: input.containerId,
    currentKek: input.currentKek,
    currentKeyMaterial: input.currentKeyMaterial,
    keyEpoch: input.keyEpoch,
    successorContainerKey: containerKey,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  return { containerKey, containerKeyEpochId, keyring, predecessorBridge };
}
