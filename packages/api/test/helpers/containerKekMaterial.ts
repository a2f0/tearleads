import {
  type ContainerKeyEpoch,
  computeContainerKekMaterialId,
  createContainerKekPredecessorBridge,
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
  readonly predecessorContainerKeyEpochId: string;
  readonly successorContainerKeyEpochId: string;
}) {
  return createContainerKekPredecessorBridge({
    ...input,
    predecessorContainerKey: crypto.getRandomValues(new Uint8Array(32)),
    successorContainerKey: crypto.getRandomValues(new Uint8Array(32)),
  });
}
