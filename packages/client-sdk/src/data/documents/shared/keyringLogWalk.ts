import type { ContainerKekKeyringEntry } from "@tearleads/crypto";
import {
  computeContainerKekMaterialId,
  normalizeContainerKekPredecessorBridge,
  unwrapContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import type { ContainerKekLogEpochResponse } from "@tearleads/validators/response";

/**
 * Recovers a predecessor key through one bridge, or null when the link is
 * absent, malformed, undecryptable, or decrypts to material that contradicts
 * the epoch id's commitment. The commitment check lives HERE, before the
 * caller's anchor fallback, so a lying link can never mask a valid anchor.
 */
/**
 * A whole rotation log assembled from pages. Distinct from the wire type,
 * which describes ONE bounded page and rejects more epochs than a page may
 * carry — an aggregate legitimately exceeds that.
 */
export interface AggregatedContainerKekLog {
  readonly containerId: string;
  readonly epochs: ContainerKekLogEpochResponse[];
}

/**
 * Recovers a predecessor key through one bridge, or null when the link is
 * absent, malformed, undecryptable, or decrypts to material that contradicts
 * the epoch id's commitment. The commitment check lives HERE, before the
 * caller's anchor fallback, so a lying link can never mask a valid anchor.
 */
async function keyFromBridge(input: {
  containerId: string;
  epoch: ContainerKekLogEpochResponse;
  predecessor: ContainerKekLogEpochResponse;
  successorKey: Uint8Array;
}): Promise<Uint8Array | null> {
  if (input.epoch.bridge === null) {
    return null;
  }
  let key: Uint8Array;
  try {
    const bridge = normalizeContainerKekPredecessorBridge(input.epoch.bridge);
    if (
      bridge.containerId !== input.containerId ||
      bridge.successorContainerKeyEpochId !== input.epoch.containerKeyEpochId ||
      bridge.predecessorContainerKeyEpochId !==
        input.predecessor.containerKeyEpochId
    ) {
      return null;
    }
    key = await unwrapContainerKekPredecessorBridge({
      bridge,
      successorContainerKey: input.successorKey,
    });
  } catch {
    return null;
  }
  const bridgedId = await computeContainerKekMaterialId({
    containerId: input.containerId,
    keyEpoch: input.predecessor.containerKeyEpoch,
    keyMaterial: key,
  });
  return bridgedId === input.predecessor.containerKeyEpochId ? key : null;
}

export interface KeyringRebuildResult {
  /** Recovered entries in ascending epoch order, gaps omitted. */
  readonly entries: ContainerKekKeyringEntry[];
  /**
   * Epoch ids the log could not reach — a severed bridge below them with no
   * anchor supplied. A repair is only complete when this is empty; each id
   * here is recoverable through `recoverKeyringEntryFromWraps` and can be
   * fed back as an anchor.
   */
  readonly missingEpochIds: string[];
}

/**
 * Rebuilds the container's keyring entries from the append-only bridge log —
 * the recovery path when a served keyring fails verification. Each link was
 * written once by the rotator that provably held both keys, so the walk
 * depends only on server-persisted state plus the current KEK; every
 * recovered key is checked against the material-id commitment its epoch id
 * carries.
 *
 * A severed bridge does not abort the walk. Recovery resumes below the gap
 * from any `anchorKeysByEpochId` entry the caller wrap-recovered, so a
 * multi-epoch history with a damaged middle link is rebuilt segment by
 * segment rather than lost wholesale. Unreachable epochs are reported in
 * `missingEpochIds` instead of throwing, because a partial rebuild plus a
 * named gap is strictly more useful to a repair than an exception.
 */
export async function rebuildKeyringEntriesFromLog(input: {
  /** Wrap-recovered keys that re-anchor the walk below a severed bridge. */
  anchorKeysByEpochId?: ReadonlyMap<string, Uint8Array> | undefined;
  containerId: string;
  currentContainerKey: Uint8Array;
  currentContainerKeyEpochId: string;
  log: AggregatedContainerKekLog;
}): Promise<KeyringRebuildResult> {
  if (input.log.containerId !== input.containerId) {
    throw new Error("Container KEK log container is inconsistent");
  }
  const epochs = [...input.log.epochs].sort(
    (left, right) => left.containerKeyEpoch - right.containerKeyEpoch,
  );
  const genesis = epochs[0];
  const tail = epochs.at(-1);
  if (!genesis || genesis.containerKeyEpoch !== 1) {
    throw new Error("Container KEK log does not start at epoch 1");
  }
  if (!tail || tail.containerKeyEpochId !== input.currentContainerKeyEpochId) {
    throw new Error("Container KEK log does not end at the current epoch");
  }

  const anchors = input.anchorKeysByEpochId ?? new Map<string, Uint8Array>();
  const recovered = new Map<string, Uint8Array>();
  const missingEpochIds: string[] = [];
  let successorKey: Uint8Array | null = input.currentContainerKey;

  for (let index = epochs.length - 1; index >= 1; index -= 1) {
    const epoch = epochs[index];
    const predecessor = epochs[index - 1];
    if (
      !epoch ||
      !predecessor ||
      epoch.containerKeyEpoch !== predecessor.containerKeyEpoch + 1
    ) {
      throw new Error("Container KEK log is not contiguous");
    }

    // Severed, poisoned, or lying links all degrade to "no key from the
    // bridge"; the walk then picks back up from a wrap-recovered anchor if
    // the caller supplied one, so only truly unreachable epochs are lost.
    let predecessorKey: Uint8Array | null =
      successorKey === null
        ? null
        : await keyFromBridge({
            containerId: input.containerId,
            epoch,
            predecessor,
            successorKey,
          });
    predecessorKey ??= anchors.get(predecessor.containerKeyEpochId) ?? null;

    if (predecessorKey === null) {
      missingEpochIds.push(predecessor.containerKeyEpochId);
      successorKey = null;
      continue;
    }
    const expectedId = await computeContainerKekMaterialId({
      containerId: input.containerId,
      keyEpoch: predecessor.containerKeyEpoch,
      keyMaterial: predecessorKey,
    });
    if (expectedId !== predecessor.containerKeyEpochId) {
      // Only reachable when a supplied anchor is itself wrong.
      missingEpochIds.push(predecessor.containerKeyEpochId);
      successorKey = null;
      continue;
    }
    recovered.set(predecessor.containerKeyEpochId, predecessorKey);
    successorKey = predecessorKey;
  }

  const entries: ContainerKekKeyringEntry[] = [];
  for (const epoch of epochs.slice(0, -1)) {
    const keyMaterial = recovered.get(epoch.containerKeyEpochId);
    if (keyMaterial) {
      entries.push({
        containerKeyEpochId: epoch.containerKeyEpochId,
        keyMaterial,
      });
    }
  }
  return { entries, missingEpochIds: missingEpochIds.reverse() };
}
