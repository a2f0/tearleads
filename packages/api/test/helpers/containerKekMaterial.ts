import {
  type ContainerKekKeyringEntry,
  type ContainerKeyEpoch,
  computeContainerKekMaterialId,
  createContainerKekPredecessorBridge,
  sealContainerKekKeyring,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";

export function createRootContainerKeyEpoch(input: {
  readonly containerKeyEpochId: string;
  readonly keyEpoch: number;
  readonly manifest: AccessManifestBundleWire;
}): ContainerKeyEpoch {
  const manifest = input.manifest as unknown as VerifiedContainerAccessManifest;

  return {
    id: input.containerKeyEpochId,
    containerId: manifest.state.containerId,
    keyEpoch: input.keyEpoch,
    accessManifestHash: manifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: manifest.event.eventHash,
    createdByManifestHash: manifest.manifestHash,
  };
}

export async function createTestContainerKekMaterial(input: {
  readonly containerId: string;
  readonly keyEpoch: number;
}): Promise<{
  readonly containerKeyEpochId: string;
  readonly plaintextKek: Uint8Array;
}> {
  const plaintextKek = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId: input.containerId,
    keyEpoch: input.keyEpoch,
    keyMaterial: plaintextKek,
  });

  return { containerKeyEpochId, plaintextKek };
}

export async function createTestContainerKekId(
  containerId: string,
  keyEpoch: number,
): Promise<string> {
  const material = await createTestContainerKekMaterial({
    containerId,
    keyEpoch,
  });
  return material.containerKeyEpochId;
}

export async function createTestContainerKekPredecessorBridge(input: {
  readonly containerId: string;
  readonly predecessorContainerKey?: Uint8Array | undefined;
  readonly predecessorContainerKeyEpochId: string;
  readonly successorContainerKey?: Uint8Array | undefined;
  readonly successorContainerKeyEpochId: string;
}) {
  return createContainerKekPredecessorBridge({
    containerId: input.containerId,
    predecessorContainerKey:
      input.predecessorContainerKey ??
      crypto.getRandomValues(new Uint8Array(32)),
    predecessorContainerKeyEpochId: input.predecessorContainerKeyEpochId,
    successorContainerKey:
      input.successorContainerKey ?? crypto.getRandomValues(new Uint8Array(32)),
    successorContainerKeyEpochId: input.successorContainerKeyEpochId,
  });
}

/**
 * Filler predecessor entries for helpers that rotate on top of state whose
 * real historical keys are unknown to the test. The server never opens a
 * keyring, so only the entry count and material-id shape matter; per-entry
 * content verification is a client-side concern.
 */
export async function createTestFillerKeyringEntries(input: {
  readonly containerId: string;
  readonly count: number;
}): Promise<ContainerKekKeyringEntry[]> {
  const entries: ContainerKekKeyringEntry[] = [];
  for (let epoch = 1; epoch <= input.count; epoch += 1) {
    const material = await createTestContainerKekMaterial({
      containerId: input.containerId,
      keyEpoch: epoch,
    });
    entries.push({
      containerKeyEpochId: material.containerKeyEpochId,
      keyMaterial: material.plaintextKek,
    });
  }
  return entries;
}

/**
 * Seals the rotation keyring for a test rotation: the previous keyring's
 * entries (all epochs before the retiring one) plus the retiring epoch's
 * key, under the new epoch's key.
 */
export async function createTestContainerKekKeyring(input: {
  readonly containerId: string;
  readonly keyEpoch: number;
  readonly predecessorEntries?: readonly ContainerKekKeyringEntry[];
  readonly retiringContainerKey: Uint8Array;
  readonly retiringContainerKeyEpochId: string;
  readonly successorContainerKey: Uint8Array;
  readonly successorContainerKeyEpochId: string;
}) {
  return sealContainerKekKeyring({
    containerId: input.containerId,
    entries: [
      ...(input.predecessorEntries ?? []),
      {
        containerKeyEpochId: input.retiringContainerKeyEpochId,
        keyMaterial: input.retiringContainerKey,
      },
    ],
    keyEpoch: input.keyEpoch,
    successorContainerKey: input.successorContainerKey,
    successorContainerKeyEpochId: input.successorContainerKeyEpochId,
  });
}
