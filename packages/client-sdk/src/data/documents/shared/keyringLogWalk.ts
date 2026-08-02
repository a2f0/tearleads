import type { ContainerKekKeyringEntry } from "@tearleads/crypto";
import {
  computeContainerKekMaterialId,
  normalizeContainerKekKeyring,
  normalizeContainerKekPredecessorBridge,
  openContainerKekKeyring,
  unwrapContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import type { ContainerKekLogEpochResponse } from "@tearleads/validators/response";

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

/**
 * Opens every served keyring the caller already holds a key for and records
 * the epochs it seals. The server serves at most one keyring per request, so
 * this is normally a single decrypt; a repair that pages the log can supply
 * several across calls.
 *
 * A keyring is only opened under a key whose epoch it belongs to — the current
 * KEK for the head epoch, or a wrap-recovered anchor for a historical one —
 * and each recovered entry must match the material-id commitment carried by
 * the epoch id it claims. Anything that fails is skipped in silence: this is a
 * best-effort accelerator, and the bridge walk that follows remains the
 * correctness-bearing path.
 */
async function seedFromServedKeyrings(input: {
  anchors: ReadonlyMap<string, Uint8Array>;
  containerId: string;
  currentContainerKey: Uint8Array;
  currentContainerKeyEpochId: string;
  epochs: readonly ContainerKekLogEpochResponse[];
  recovered: Map<string, Uint8Array>;
}): Promise<void> {
  const epochById = new Map(
    input.epochs.map((epoch) => [epoch.containerKeyEpochId, epoch]),
  );

  for (const epoch of input.epochs) {
    if (epoch.keyring === null) {
      continue;
    }
    const sealingKey =
      epoch.containerKeyEpochId === input.currentContainerKeyEpochId
        ? input.currentContainerKey
        : input.anchors.get(epoch.containerKeyEpochId);
    if (!sealingKey) {
      continue;
    }

    let entries: ContainerKekKeyringEntry[];
    try {
      entries = await openContainerKekKeyring({
        keyEpoch: epoch.containerKeyEpoch,
        keyring: normalizeContainerKekKeyring(epoch.keyring),
        successorContainerKey: sealingKey,
      });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const sealed = epochById.get(entry.containerKeyEpochId);
      if (!sealed || input.recovered.has(entry.containerKeyEpochId)) {
        continue;
      }
      const materialId = await computeContainerKekMaterialId({
        containerId: input.containerId,
        keyEpoch: sealed.containerKeyEpoch,
        keyMaterial: entry.keyMaterial,
      });
      if (materialId === entry.containerKeyEpochId) {
        input.recovered.set(entry.containerKeyEpochId, entry.keyMaterial);
      }
    }
  }
}

/**
 * The log's epochs in ascending order, once it is established that they are a
 * complete history for this container: same container, rooted at epoch 1, and
 * ending at the caller's current epoch. A rebuild that started mid-history
 * would silently report the epochs below its start as unreachable, so the
 * shape is checked up front rather than inferred from a thin result.
 */
function sortedCompleteLogEpochs(input: {
  containerId: string;
  currentContainerKeyEpochId: string;
  log: AggregatedContainerKekLog;
}): ContainerKekLogEpochResponse[] {
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
  return epochs;
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
  const epochs = sortedCompleteLogEpochs(input);

  const anchors = input.anchorKeysByEpochId ?? new Map<string, Uint8Array>();
  const recovered = new Map<string, Uint8Array>();
  const missingEpochIds: string[] = [];
  let successorKey: Uint8Array | null = input.currentContainerKey;

  // Rung one of the ladder: a served keyring recovers every epoch beneath it
  // in a single decrypt. That is what lets a rebuild cross MORE THAN ONE
  // severed bridge — the bridge walk below can only step over a gap it has an
  // anchor for, while a keyring held at any reachable epoch supplies the whole
  // history under it at once. Entries are verified against their material-id
  // commitments before use, so a forged keyring contributes nothing.
  await seedFromServedKeyrings({
    anchors,
    containerId: input.containerId,
    currentContainerKey: input.currentContainerKey,
    currentContainerKeyEpochId: input.currentContainerKeyEpochId,
    epochs,
    recovered,
  });

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
    predecessorKey ??= recovered.get(predecessor.containerKeyEpochId) ?? null;
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
