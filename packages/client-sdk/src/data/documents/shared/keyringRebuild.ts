import type { ContainerKekKeyringEntry } from "@tearleads/crypto";
import {
  computeContainerKekMaterialId,
  normalizeContainerKekPredecessorBridge,
  unwrapContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import type {
  ContainerKekLogEpochResponse,
  ContainerKekLogResponse,
} from "@tearleads/validators/response";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../../principalPolicyCrypto";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { normalizeContainerKeyWrap } from "./readers";

/**
 * The severed-bridge backstop: recovers one historical epoch's KEK from the
 * requester's own retained recipient envelope served in the kek-log. Wraps
 * are written by that epoch's rotator and never deleted, so this path is
 * independent of every later rotation — it works even when the bridge chain
 * above the epoch is destroyed. The recovered key is verified against the
 * epoch id's material commitment before use.
 */
export async function recoverKeyringEntryFromWraps(input: {
  containerId: string;
  epoch: Pick<
    ContainerKekLogEpochResponse,
    "containerKeyEpoch" | "containerKeyEpochId" | "wraps"
  >;
  execSql?: ExecSql | undefined;
  secretKey: Uint8Array;
}): Promise<ContainerKekKeyringEntry> {
  const envelopes = input.epoch.wraps
    .map((wrap) => normalizeContainerKeyWrap(wrap))
    .filter(
      (wrap) =>
        wrap.containerKeyEpochId === input.epoch.containerKeyEpochId &&
        wrap.recipientKind !== "container",
    )
    .map((wrap) => ({
      keyFingerprint: wrap.recipientKeyFingerprint,
      kemCipherText: wrap.kemCipherText,
      wrappedKey: wrap.wrappedKey,
    }));
  if (envelopes.length === 0) {
    throw new Error(
      `Container KEK log has no recipient envelope for epoch ${input.epoch.containerKeyEpoch}`,
    );
  }
  const keyMaterial = await unwrapKeyEnvelopesWithPrincipalPolicies({
    envelopes,
    execSql: input.execSql,
    secretKey: input.secretKey,
  });
  const expectedId = await computeContainerKekMaterialId({
    containerId: input.containerId,
    keyEpoch: input.epoch.containerKeyEpoch,
    keyMaterial,
  });
  if (expectedId !== input.epoch.containerKeyEpochId) {
    throw new Error(
      `Container KEK log wrap does not match its committed epoch id at epoch ${input.epoch.containerKeyEpoch}`,
    );
  }
  return {
    containerKeyEpochId: input.epoch.containerKeyEpochId,
    keyMaterial,
  };
}

/**
 * Rebuilds the container's keyring entries from the append-only bridge log —
 * the recovery path when a served keyring fails verification. Each link was
 * written once by the rotator that provably held both keys, so the walk
 * depends only on server-persisted state plus the current KEK; every
 * recovered key is checked against the material-id commitment its epoch id
 * carries. Returns entries for epochs 1..n-1 in ascending order, ready to
 * re-seal via a repair rekey.
 */
export async function rebuildKeyringEntriesFromLog(input: {
  containerId: string;
  currentContainerKey: Uint8Array;
  currentContainerKeyEpochId: string;
  log: ContainerKekLogResponse;
}): Promise<ContainerKekKeyringEntry[]> {
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

  let successorKey = input.currentContainerKey;
  const entries: ContainerKekKeyringEntry[] = [];
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
    if (epoch.bridge === null) {
      throw new Error(
        `Container KEK log bridge is missing at epoch ${epoch.containerKeyEpoch}`,
      );
    }
    const bridge = normalizeContainerKekPredecessorBridge(epoch.bridge);
    if (
      bridge.containerId !== input.containerId ||
      bridge.successorContainerKeyEpochId !== epoch.containerKeyEpochId ||
      bridge.predecessorContainerKeyEpochId !== predecessor.containerKeyEpochId
    ) {
      throw new Error(
        `Container KEK log bridge is inconsistent at epoch ${epoch.containerKeyEpoch}`,
      );
    }
    const predecessorKey = await unwrapContainerKekPredecessorBridge({
      bridge,
      successorContainerKey: successorKey,
    });
    const expectedId = await computeContainerKekMaterialId({
      containerId: input.containerId,
      keyEpoch: predecessor.containerKeyEpoch,
      keyMaterial: predecessorKey,
    });
    if (expectedId !== predecessor.containerKeyEpochId) {
      throw new Error(
        `Container KEK log key does not match its committed epoch id at epoch ${predecessor.containerKeyEpoch}`,
      );
    }
    entries.push({
      containerKeyEpochId: predecessor.containerKeyEpochId,
      keyMaterial: predecessorKey,
    });
    successorKey = predecessorKey;
  }
  return entries.reverse();
}
