import type { ContainerKekKeyringEntry } from "@tearleads/crypto";
import {
  computeContainerKekMaterialId,
  decryptWithDek,
  normalizeContainerKekPredecessorBridge,
  unwrapContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  ContainerKekLogEpochResponse,
  ContainerKekLogResponse,
} from "@tearleads/validators/response";
import { MAX_CONTAINER_KEY_EPOCH } from "@tearleads/validators/util";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../../principalPolicyCrypto";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { normalizeContainerKeyWrap } from "./readers";

/**
 * Raised when the requester holds no envelope they can open for a historical
 * epoch. Distinct from corruption: the log is intact, the caller simply is
 * not an anchor for this epoch.
 */
export type HistoricalWrapUnavailableReason =
  /** No envelope at this epoch is addressed to the requester at all. */
  | "no-addressed-envelope"
  /** A direct user envelope exists for the requester but did not open. */
  | "corrupt-envelope"
  /** Only principal-addressed envelopes, whose key epoch is unreachable. */
  | "principal-key-unreachable"
  /** Only a parent-container envelope, and the parent KEK was not supplied. */
  | "parent-key-unavailable";

const HISTORICAL_WRAP_UNAVAILABLE_MESSAGES: Record<
  HistoricalWrapUnavailableReason,
  (epoch: number) => string
> = {
  "no-addressed-envelope": (epoch) =>
    `Container KEK log has no envelope addressed to this requester at epoch ${epoch}`,
  "corrupt-envelope": (epoch) =>
    `Container KEK log envelope for this requester at epoch ${epoch} could not be opened`,
  "principal-key-unreachable": (epoch) =>
    `Container KEK log envelope at epoch ${epoch} is addressed to a principal key epoch this client cannot resolve`,
  "parent-key-unavailable": (epoch) =>
    `Container KEK log envelope at epoch ${epoch} is inherited from a parent container whose KEK was not supplied`,
};

export class HistoricalWrapUnavailableError extends Error {
  constructor(
    readonly containerKeyEpoch: number,
    readonly reason: HistoricalWrapUnavailableReason,
    cause?: unknown,
  ) {
    super(
      HISTORICAL_WRAP_UNAVAILABLE_MESSAGES[reason](containerKeyEpoch),
      cause === undefined ? undefined : { cause },
    );
    this.name = "HistoricalWrapUnavailableError";
  }
}

/**
 * The severed-bridge backstop: recovers one historical epoch's KEK from the
 * requester's own retained recipient envelope served in the kek-log. Wraps
 * are written by that epoch's rotator and never deleted, so this path is
 * independent of every later rotation — it works even when the bridge chain
 * above the epoch is destroyed. The recovered key is verified against the
 * epoch id's material commitment before use.
 *
 * Scope bound: a direct user envelope is recoverable from identity keys
 * alone, so a pristine client anchors on it. A group- or organization-
 * addressed envelope additionally requires the principal SECRET key for the
 * key epoch it was addressed to, which resolves only through principal
 * policy bundles the client can reach; after a principal key rotation a
 * pristine client cannot reach the older ones, and this fails closed with
 * `HistoricalWrapUnavailableError` rather than appearing to be corruption.
 * Serving historical principal-policy states is tracked separately.
 */
export async function recoverKeyringEntryFromWraps(input: {
  containerId: string;
  epoch: Pick<
    ContainerKekLogEpochResponse,
    "containerKeyEpoch" | "containerKeyEpochId" | "wraps"
  >;
  execSql?: ExecSql | undefined;
  secretKey: Uint8Array;
  /**
   * Parent container KEKs by epoch id. An inherited-only child has no direct
   * or principal envelope of its own; its anchor is the parent-container
   * wrap, which opens under the parent epoch's KEK. Recover the parent's
   * epoch first (recursively, through the parent's own log) and pass it here.
   */
  parentKeysByEpochId?: ReadonlyMap<string, Uint8Array> | undefined;
  /**
   * The requester's user id. Direct user envelopes are matched against it, so
   * another member's envelope is never mistaken for an anchor — attempting it
   * would only produce a misleading failure.
   */
  userId: string;
}): Promise<ContainerKekKeyringEntry> {
  const epochWraps = input.epoch.wraps
    .map((wrap) => normalizeContainerKeyWrap(wrap))
    .filter(
      (wrap) => wrap.containerKeyEpochId === input.epoch.containerKeyEpochId,
    );
  // Only envelopes this requester could plausibly open: their own direct user
  // envelope, or principal envelopes whose secret key their policies may
  // resolve. A container (parent) wrap is not an identity anchor.
  const directWraps = epochWraps.filter(
    (wrap) =>
      wrap.recipientKind === "user" && wrap.recipientId === input.userId,
  );
  const principalWraps = epochWraps.filter(
    (wrap) =>
      wrap.recipientKind === "group" || wrap.recipientKind === "organization",
  );
  const parentWraps = epochWraps.filter(
    (wrap) => wrap.recipientKind === "container",
  );
  if (
    directWraps.length === 0 &&
    principalWraps.length === 0 &&
    parentWraps.length === 0
  ) {
    throw new HistoricalWrapUnavailableError(
      input.epoch.containerKeyEpoch,
      "no-addressed-envelope",
    );
  }

  const toEnvelope = (wrap: (typeof epochWraps)[number]) => ({
    keyFingerprint: wrap.recipientKeyFingerprint,
    kemCipherText: wrap.kemCipherText,
    wrappedKey: wrap.wrappedKey,
  });
  let keyMaterial: Uint8Array | null = null;
  let directFailure: unknown;
  // A direct envelope is decryptable from identity keys alone, so its failure
  // means corruption — not an unreachable principal key.
  if (directWraps.length > 0) {
    try {
      keyMaterial = await unwrapKeyEnvelopesWithPrincipalPolicies({
        envelopes: directWraps.map(toEnvelope),
        execSql: input.execSql,
        secretKey: input.secretKey,
      });
    } catch (error) {
      directFailure = error;
    }
  }
  let principalFailure: unknown;
  if (keyMaterial === null && principalWraps.length > 0) {
    try {
      keyMaterial = await unwrapKeyEnvelopesWithPrincipalPolicies({
        envelopes: principalWraps.map(toEnvelope),
        execSql: input.execSql,
        secretKey: input.secretKey,
      });
    } catch (error) {
      // Do not fail yet: a parent-container wrap may still anchor this
      // epoch, and an unreachable principal key must not mask it.
      principalFailure = error;
    }
  }
  // The inherited-only path: a parent-container envelope opens under the
  // parent epoch's KEK, which the caller recovers from the parent's own log.
  let parentFailure: unknown;
  let parentKeyWasAvailable = false;
  if (keyMaterial === null && parentWraps.length > 0) {
    const parentKeys = input.parentKeysByEpochId ?? new Map();
    for (const wrap of parentWraps) {
      const parentKey = parentKeys.get(wrap.recipientKeyEpochId);
      if (!parentKey) {
        continue;
      }
      parentKeyWasAvailable = true;
      try {
        keyMaterial = await decryptWithDek(
          {
            iv: base64ToBytes(wrap.kemCipherText),
            ciphertext: base64ToBytes(wrap.wrappedKey),
          },
          parentKey,
        );
        break;
      } catch (error) {
        parentFailure = error;
      }
    }
  }
  if (keyMaterial === null) {
    // Every anchor kind was tried; report the most specific reason. A wrap
    // that was actually attempted and failed is corruption; one that could
    // not be attempted names the key that was missing.
    if (directFailure !== undefined || parentFailure !== undefined) {
      throw new HistoricalWrapUnavailableError(
        input.epoch.containerKeyEpoch,
        "corrupt-envelope",
        directFailure ?? parentFailure,
      );
    }
    if (principalFailure !== undefined) {
      throw new HistoricalWrapUnavailableError(
        input.epoch.containerKeyEpoch,
        "principal-key-unreachable",
        principalFailure,
      );
    }
    throw new HistoricalWrapUnavailableError(
      input.epoch.containerKeyEpoch,
      parentWraps.length > 0 && !parentKeyWasAvailable
        ? "parent-key-unavailable"
        : "no-addressed-envelope",
    );
  }
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
 * Fetches the container's complete rotation log across pages. The endpoint
 * bounds each page, so a long-lived container needs several round trips; the
 * cursor is the last served epoch number.
 */
export async function fetchContainerKekLog(input: {
  apiClient: {
    getContainerKekLog(
      containerId: string,
      options?: {
        readonly afterKeyEpoch?: number;
        readonly keyringForEpoch?: number;
      },
    ): Promise<ContainerKekLogResponse | null>;
  };
  containerId: string;
  /** Ask for one historical keyring by epoch number; blobs are never bulk. */
  keyringForEpoch?: number | undefined;
}): Promise<ContainerKekLogResponse> {
  const epochs: ContainerKekLogResponse["epochs"] = [];
  let afterKeyEpoch = 0;
  // A hostile server could claim `hasMore` forever with ever-advancing epoch
  // numbers. The protocol caps lifetime rotations, so the walk is capped too.
  while (afterKeyEpoch < MAX_CONTAINER_KEY_EPOCH) {
    const page = await input.apiClient.getContainerKekLog(input.containerId, {
      afterKeyEpoch,
      ...(input.keyringForEpoch === undefined
        ? {}
        : { keyringForEpoch: input.keyringForEpoch }),
    });
    if (!page) {
      throw new Error("Container KEK log is unavailable");
    }
    epochs.push(...page.epochs);
    if (!page.hasMore) {
      return { containerId: page.containerId, epochs, hasMore: false };
    }
    const lastEpoch = page.epochs.at(-1)?.containerKeyEpoch;
    if (lastEpoch === undefined || lastEpoch <= afterKeyEpoch) {
      throw new Error("Container KEK log page did not advance");
    }
    if (lastEpoch > MAX_CONTAINER_KEY_EPOCH) {
      throw new Error("Container KEK log exceeds the maximum key epoch");
    }
    afterKeyEpoch = lastEpoch;
  }
  throw new Error("Container KEK log exceeds the maximum key epoch");
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
  log: ContainerKekLogResponse;
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

    let predecessorKey: Uint8Array | null = null;
    if (successorKey !== null && epoch.bridge !== null) {
      // A malformed or undecryptable bridge is severance, not a fatal error:
      // a poisoned link is exactly the case the wrap anchors exist for, so
      // treat it like a missing one and let the fallback below run.
      try {
        const bridge = normalizeContainerKekPredecessorBridge(epoch.bridge);
        if (
          bridge.containerId !== input.containerId ||
          bridge.successorContainerKeyEpochId !== epoch.containerKeyEpochId ||
          bridge.predecessorContainerKeyEpochId !==
            predecessor.containerKeyEpochId
        ) {
          throw new Error(
            `Container KEK log bridge is inconsistent at epoch ${epoch.containerKeyEpoch}`,
          );
        }
        predecessorKey = await unwrapContainerKekPredecessorBridge({
          bridge,
          successorContainerKey: successorKey,
        });
      } catch {
        predecessorKey = null;
      }
    }
    // A bridge key is only usable if it matches the epoch id's commitment. A
    // lying-but-AEAD-valid bridge is therefore discarded here, BEFORE the
    // anchor fallback, so a supplied anchor still wins — checking the anchor
    // only when the bridge is absent would let a lying link mask it.
    if (predecessorKey !== null) {
      const bridgedId = await computeContainerKekMaterialId({
        containerId: input.containerId,
        keyEpoch: predecessor.containerKeyEpoch,
        keyMaterial: predecessorKey,
      });
      if (bridgedId !== predecessor.containerKeyEpochId) {
        predecessorKey = null;
      }
    }
    // Severed, poisoned, or lying: pick the walk back up from a
    // wrap-recovered anchor if the caller supplied one, so only the truly
    // unreachable epochs are lost.
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
