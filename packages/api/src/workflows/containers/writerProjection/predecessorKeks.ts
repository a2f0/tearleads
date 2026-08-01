import {
  computeContainerKeyEpochHash,
  normalizeContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import type { PredecessorContainerKekResponse } from "@tearleads/validators/response";
import {
  getContainerKeyEpochById,
  listContainerKeyEpochs,
} from "../../../access/read/containerKekStore";
import { cachedProjectionValue } from "./context";
import { containerKeyEpochRecord, stripContainerKeyEpoch } from "./records";
import {
  type ContainerKekHistoryDegradationReason,
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
} from "./types";

function bridgeRecord(
  bridge: ReturnType<typeof normalizeContainerKekPredecessorBridge>,
): Record<string, unknown> {
  return {
    version: bridge.version,
    wrappingSuite: bridge.wrappingSuite,
    containerId: bridge.containerId,
    predecessorContainerKeyEpochId: bridge.predecessorContainerKeyEpochId,
    successorContainerKeyEpochId: bridge.successorContainerKeyEpochId,
    iv: bridge.iv,
    wrappedKey: bridge.wrappedKey,
  };
}

function finishPredecessorLoad(input: {
  readonly containerId: string;
  readonly context: ContainerWriterProjectionContext;
  readonly currentContainerKeyEpochId: string;
  readonly degradationReason: ContainerKekHistoryDegradationReason | null;
  readonly predecessors: PredecessorContainerKekResponse[];
  readonly storedEpochCount: number;
}): PredecessorContainerKekResponse[] {
  try {
    input.context.observeContainerKekHistory({
      containerId: input.containerId,
      currentContainerKeyEpochId: input.currentContainerKeyEpochId,
      degradationReason: input.degradationReason,
      predecessorCount: input.predecessors.length,
      storedEpochCount: input.storedEpochCount,
    });
  } catch (error) {
    console.error("Failed to observe container KEK predecessor history", error);
  }
  return input.predecessors;
}

/**
 * Follows the immutable successor-to-predecessor bridge chain. The caller has
 * already established current read/write access, so no historical audience
 * filtering belongs here: current document access is history-inclusive.
 */
async function loadPredecessorContainerKeksUncached(input: {
  readonly containerKeyEpochId: string;
  readonly context: ContainerWriterProjectionContext;
}): Promise<PredecessorContainerKekResponse[]> {
  const currentEpoch = await getContainerKeyEpochById(
    input.containerKeyEpochId,
    input.context.executor,
  );
  if (!currentEpoch) {
    throw new ContainerWriterProjectionError("Container KEK missing", 409);
  }
  const epochs = await listContainerKeyEpochs(
    currentEpoch.containerId,
    input.context.executor,
  );
  const epochsById = new Map(epochs.map((epoch) => [epoch.id, epoch]));

  const predecessors: PredecessorContainerKekResponse[] = [];
  const visitedEpochIds = new Set([currentEpoch.id]);
  let successor = currentEpoch;

  while (successor.predecessorBridge) {
    let bridge: ReturnType<typeof normalizeContainerKekPredecessorBridge>;
    try {
      bridge = normalizeContainerKekPredecessorBridge(
        successor.predecessorBridge,
      );
    } catch {
      return finishPredecessorLoad({
        containerId: currentEpoch.containerId,
        context: input.context,
        currentContainerKeyEpochId: currentEpoch.id,
        degradationReason: "malformed_bridge",
        predecessors,
        storedEpochCount: epochs.length,
      });
    }
    if (
      bridge.containerId !== currentEpoch.containerId ||
      bridge.successorContainerKeyEpochId !== successor.id ||
      visitedEpochIds.has(bridge.predecessorContainerKeyEpochId)
    ) {
      return finishPredecessorLoad({
        containerId: currentEpoch.containerId,
        context: input.context,
        currentContainerKeyEpochId: currentEpoch.id,
        degradationReason: "inconsistent_bridge",
        predecessors,
        storedEpochCount: epochs.length,
      });
    }

    const predecessor = epochsById.get(bridge.predecessorContainerKeyEpochId);
    if (
      !predecessor ||
      predecessor.containerId !== currentEpoch.containerId ||
      predecessor.keyEpoch !== successor.keyEpoch - 1
    ) {
      return finishPredecessorLoad({
        containerId: currentEpoch.containerId,
        context: input.context,
        currentContainerKeyEpochId: currentEpoch.id,
        degradationReason: "missing_or_nonconsecutive_predecessor",
        predecessors,
        storedEpochCount: epochs.length,
      });
    }

    const keyEpoch = stripContainerKeyEpoch(predecessor);
    predecessors.push({
      accessManifestHash: predecessor.accessManifestHash,
      bridge: bridgeRecord(bridge),
      containerId: predecessor.containerId,
      containerKeyEpoch: predecessor.keyEpoch,
      containerKeyEpochId: predecessor.id,
      keyEpoch: containerKeyEpochRecord(keyEpoch),
      keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
      parentContainerKeyEpochId: predecessor.parentContainerKeyEpochId,
    });
    visitedEpochIds.add(predecessor.id);
    successor = predecessor;
  }

  return finishPredecessorLoad({
    containerId: currentEpoch.containerId,
    context: input.context,
    currentContainerKeyEpochId: currentEpoch.id,
    degradationReason: successor.keyEpoch === 1 ? null : "missing_bridge",
    predecessors,
    storedEpochCount: epochs.length,
  });
}

export function loadPredecessorContainerKeks(input: {
  readonly containerKeyEpochId: string;
  readonly context: ContainerWriterProjectionContext;
}): Promise<PredecessorContainerKekResponse[]> {
  return cachedProjectionValue(
    input.context.predecessorContainerKeksByEpochId,
    input.containerKeyEpochId,
    () => loadPredecessorContainerKeksUncached(input),
  );
}
