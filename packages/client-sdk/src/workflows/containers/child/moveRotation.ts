import type { ContainerKekPredecessorBridge } from "@tearleads/crypto";
import { createContainerKekPredecessorBridge } from "@tearleads/crypto";
import type { ContainerKekResponse } from "@tearleads/validators/response";
import { resolveContainerKekEpochId } from "../../../data/containers/shared/events";

export async function buildContainerMoveRotation(input: {
  containerId: string;
  currentKek: ContainerKekResponse;
  keyEpoch: number;
  override?: string | undefined;
  predecessorKeyMaterial: Uint8Array;
}): Promise<{
  containerKey: Uint8Array;
  containerKeyEpochId: string;
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
    predecessorContainerKey: input.predecessorKeyMaterial,
    predecessorContainerKeyEpochId: input.currentKek.containerKeyEpochId,
    successorContainerKey: containerKey,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  return { containerKey, containerKeyEpochId, predecessorBridge };
}
