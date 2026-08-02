import type {
  ContainerKekKeyringEntry,
  ContainerKeyWrap,
} from "@tearleads/crypto";
import {
  computeContainerKekMaterialId,
  decryptWithDek,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  ContainerKekLogEpochResponse,
  ContainerKekLogResponse,
} from "@tearleads/validators/response";
import {
  CONTAINER_KEK_LOG_PAGE_LIMIT,
  MAX_CONTAINER_KEY_EPOCH,
} from "@tearleads/validators/util";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../../principalPolicyCrypto";
import type { ExecSql } from "../../sqlite/sqlSchema";
import type { AggregatedContainerKekLog } from "./keyringLogWalk";
import { normalizeContainerKeyWrap } from "./readers";

/**
 * Splits an epoch's envelopes into the anchor kinds this requester could use:
 * their own direct envelope, principal envelopes their policies may resolve,
 * and parent-container envelopes. Anything else is not an identity anchor and
 * is dropped, so it never produces a misleading failure.
 */
function partitionAnchorWraps(
  wraps: readonly Record<string, unknown>[],
  containerKeyEpochId: string,
  userId: string,
): {
  directWraps: ContainerKeyWrap[];
  epochWraps: ContainerKeyWrap[];
  parentWraps: ContainerKeyWrap[];
  principalWraps: ContainerKeyWrap[];
} {
  const forEpoch = wraps
    .map((wrap) => normalizeContainerKeyWrap(wrap))
    .filter((wrap) => wrap.containerKeyEpochId === containerKeyEpochId);
  const directWraps = forEpoch.filter(
    (wrap) => wrap.recipientKind === "user" && wrap.recipientId === userId,
  );
  const principalWraps = forEpoch.filter(
    (wrap) =>
      wrap.recipientKind === "group" || wrap.recipientKind === "organization",
  );
  const parentWraps = forEpoch.filter(
    (wrap) => wrap.recipientKind === "container",
  );
  return {
    directWraps,
    epochWraps: [...directWraps, ...principalWraps, ...parentWraps],
    parentWraps,
    principalWraps,
  };
}

/**
 * Opens the first parent-container envelope whose parent epoch key the caller
 * supplied. Reports whether any key was available, so a missing parent key is
 * distinguishable from a corrupt envelope.
 */
async function openParentAnchor(
  parentWraps: readonly ContainerKeyWrap[],
  parentKeys: ReadonlyMap<string, Uint8Array>,
): Promise<{
  failure: unknown;
  key: Uint8Array | null;
  keyWasAvailable: boolean;
}> {
  let failure: unknown;
  let keyWasAvailable = false;
  for (const wrap of parentWraps) {
    const parentKey = parentKeys.get(wrap.recipientKeyEpochId);
    if (!parentKey) {
      continue;
    }
    keyWasAvailable = true;
    try {
      return {
        failure: undefined,
        key: await decryptWithDek(
          {
            iv: base64ToBytes(wrap.kemCipherText),
            ciphertext: base64ToBytes(wrap.wrappedKey),
          },
          parentKey,
        ),
        keyWasAvailable,
      };
    } catch (error) {
      failure = error;
    }
  }
  return { failure, key: null, keyWasAvailable };
}

/**
 * Every anchor kind was tried; report the most specific reason. A wrap that
 * was actually attempted and failed is corruption; one that could not be
 * attempted names the key that was missing.
 */
function throwMostSpecificAnchorFailure(input: {
  containerKeyEpoch: number;
  directFailure: unknown;
  hadParentWraps: boolean;
  parentFailure: unknown;
  parentKeyWasAvailable: boolean;
  principalFailure: unknown;
}): never {
  if (input.directFailure !== undefined || input.parentFailure !== undefined) {
    throw new HistoricalWrapUnavailableError(
      input.containerKeyEpoch,
      "corrupt-envelope",
      input.directFailure ?? input.parentFailure,
    );
  }
  if (input.principalFailure !== undefined) {
    throw new HistoricalWrapUnavailableError(
      input.containerKeyEpoch,
      "principal-key-unreachable",
      input.principalFailure,
    );
  }
  throw new HistoricalWrapUnavailableError(
    input.containerKeyEpoch,
    input.hadParentWraps && !input.parentKeyWasAvailable
      ? "parent-key-unavailable"
      : "no-addressed-envelope",
  );
}

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
  const { directWraps, epochWraps, parentWraps, principalWraps } =
    partitionAnchorWraps(
      input.epoch.wraps,
      input.epoch.containerKeyEpochId,
      input.userId,
    );
  if (epochWraps.length === 0) {
    throw new HistoricalWrapUnavailableError(
      input.epoch.containerKeyEpoch,
      "no-addressed-envelope",
    );
  }

  const attempt = async (
    wraps: typeof epochWraps,
  ): Promise<{ key: Uint8Array | null; failure: unknown }> => {
    if (wraps.length === 0) {
      return { failure: undefined, key: null };
    }
    try {
      return {
        failure: undefined,
        key: await unwrapKeyEnvelopesWithPrincipalPolicies({
          envelopes: wraps.map((wrap) => ({
            keyFingerprint: wrap.recipientKeyFingerprint,
            kemCipherText: wrap.kemCipherText,
            wrappedKey: wrap.wrappedKey,
          })),
          execSql: input.execSql,
          secretKey: input.secretKey,
        }),
      };
    } catch (error) {
      return { failure: error, key: null };
    }
  };

  // A direct envelope is decryptable from identity keys alone, so its failure
  // means corruption — not an unreachable principal key. Neither failure ends
  // the search: a parent-container wrap may still anchor this epoch.
  const direct = await attempt(directWraps);
  let keyMaterial = direct.key;
  const directFailure = direct.failure;
  let principalFailure: unknown;
  if (keyMaterial === null) {
    const principal = await attempt(principalWraps);
    keyMaterial = principal.key;
    principalFailure = principal.failure;
  }
  // The inherited-only path: a parent-container envelope opens under the
  // parent epoch's KEK, which the caller recovers from the parent's own log.
  const parent =
    keyMaterial === null
      ? await openParentAnchor(
          parentWraps,
          input.parentKeysByEpochId ?? new Map(),
        )
      : { failure: undefined, key: null, keyWasAvailable: false };
  keyMaterial ??= parent.key;
  const parentFailure = parent.failure;
  const parentKeyWasAvailable = parent.keyWasAvailable;
  if (keyMaterial === null) {
    throwMostSpecificAnchorFailure({
      containerKeyEpoch: input.epoch.containerKeyEpoch,
      directFailure,
      hadParentWraps: parentWraps.length > 0,
      parentFailure,
      parentKeyWasAvailable,
      principalFailure,
    });
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
}): Promise<AggregatedContainerKekLog> {
  const epochs: ContainerKekLogEpochResponse[] = [];
  let afterKeyEpoch = 0;
  // A hostile server could claim `hasMore` forever. Two independent caps
  // bound the walk: the protocol's lifetime rotation ceiling, and a page
  // budget — a server that advances one epoch per page cannot force 65,536
  // round trips, because a non-final page must be full.
  const maxPages =
    Math.ceil(MAX_CONTAINER_KEY_EPOCH / CONTAINER_KEK_LOG_PAGE_LIMIT) + 1;
  let pages = 0;
  while (afterKeyEpoch < MAX_CONTAINER_KEY_EPOCH) {
    pages += 1;
    if (pages > maxPages) {
      throw new Error("Container KEK log exceeds its page budget");
    }
    const page = await input.apiClient.getContainerKekLog(input.containerId, {
      afterKeyEpoch,
      ...(input.keyringForEpoch === undefined
        ? {}
        : { keyringForEpoch: input.keyringForEpoch }),
    });
    if (!page) {
      throw new Error("Container KEK log is unavailable");
    }
    if (page.hasMore && page.epochs.length < CONTAINER_KEK_LOG_PAGE_LIMIT) {
      // Only the final page may be short; a partial page claiming more is a
      // server stretching the walk across extra round trips.
      throw new Error("Container KEK log page is short but claims more");
    }
    epochs.push(...page.epochs);
    if (epochs.length > MAX_CONTAINER_KEY_EPOCH) {
      throw new Error("Container KEK log exceeds the maximum key epoch");
    }
    const lastEpoch = page.epochs.at(-1)?.containerKeyEpoch;
    // Validate before returning, so a final page cannot smuggle an
    // out-of-range epoch past the ceiling check.
    if (lastEpoch !== undefined && lastEpoch > MAX_CONTAINER_KEY_EPOCH) {
      throw new Error("Container KEK log exceeds the maximum key epoch");
    }
    if (!page.hasMore) {
      return { containerId: page.containerId, epochs };
    }
    if (lastEpoch === undefined || lastEpoch <= afterKeyEpoch) {
      throw new Error("Container KEK log page did not advance");
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

export type {
  AggregatedContainerKekLog,
  KeyringRebuildResult,
} from "./keyringLogWalk";
export { rebuildKeyringEntriesFromLog } from "./keyringLogWalk";
