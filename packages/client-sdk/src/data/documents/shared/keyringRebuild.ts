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
        readonly includeKeyrings?: boolean;
      },
    ): Promise<ContainerKekLogResponse | null>;
  };
  containerId: string;
  includeKeyrings?: boolean | undefined;
}): Promise<ContainerKekLogResponse> {
  const epochs: ContainerKekLogResponse["epochs"] = [];
  let afterKeyEpoch = 0;
  for (;;) {
    const page = await input.apiClient.getContainerKekLog(input.containerId, {
      afterKeyEpoch,
      ...(input.includeKeyrings === undefined
        ? {}
        : { includeKeyrings: input.includeKeyrings }),
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
    afterKeyEpoch = lastEpoch;
  }
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
