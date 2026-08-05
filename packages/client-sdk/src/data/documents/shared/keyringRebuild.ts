import type {
  ContainerKekKeyringEntry,
  ContainerKeyWrap,
} from "@tearleads/crypto";
import {
  computeContainerKekMaterialId,
  decryptWithDek,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type { ContainerKekLogEpochResponse } from "@tearleads/validators/response";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "../../principalPolicyCrypto";
import type { ExecSql } from "../../sqlite/sqlSchema";
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
 * The first candidate envelope that both decrypts AND matches the epoch's
 * material-id commitment.
 *
 * Candidates are tried ONE AT A TIME. An envelope can be AEAD-valid and still
 * carry the WRONG key — a stale or misaddressed wrap — so decrypting a batch
 * together would let that one envelope answer for the whole group and mask a
 * later envelope that would have opened the epoch. The reported failure is the
 * first real decrypt failure, since a commitment mismatch is a wrong envelope
 * rather than an unreachable one.
 */
async function firstCommittedAnchor(input: {
  attempt: (
    wraps: ContainerKeyWrap[],
  ) => Promise<{ failure: unknown; key: Uint8Array | null }>;
  candidates: ContainerKeyWrap[];
  containerId: string;
  containerKeyEpoch: number;
  containerKeyEpochId: string;
}): Promise<{ failure: unknown; key: Uint8Array | null }> {
  let firstFailure: unknown;
  for (const candidate of input.candidates) {
    const result = await input.attempt([candidate]);
    if (result.key === null) {
      firstFailure ??= result.failure;
      continue;
    }
    const materialId = await computeContainerKekMaterialId({
      containerId: input.containerId,
      keyEpoch: input.containerKeyEpoch,
      keyMaterial: result.key,
    });
    if (materialId === input.containerKeyEpochId) {
      return result;
    }
    // An envelope that decrypts to the WRONG key is a misaddressed or stale
    // envelope, not an unreachable principal. Recording it keeps the reported
    // reason `corrupt-envelope`; dropping it silently would let the epoch
    // report as unaddressed, which points a repair at the wrong problem.
    //
    // Only reachable when the server files a wrap under an epoch id its
    // material does not hash to — the addressing filter already rejects a
    // wrap whose epoch id simply differs.
    firstFailure ??= new Error(
      `Container KEK envelope decrypts to material that is not epoch ${input.containerKeyEpochId}`,
    );
  }
  return { failure: firstFailure, key: null };
}

/**
 * Opens one group of envelopes with the requester's CURRENT policies, folding
 * failure into a value rather than throwing.
 *
 * The caller tries several groups in order, and a failure in one is not the
 * end of the search — so the failure has to travel back alongside the miss
 * instead of unwinding the whole recovery.
 */
async function unwrapWrapsWithCurrentPolicies(input: {
  execSql?: ExecSql | undefined;
  secretKey: Uint8Array;
  wraps: readonly ContainerKeyWrap[];
}): Promise<{ failure: unknown; key: Uint8Array | null }> {
  if (input.wraps.length === 0) {
    return { failure: undefined, key: null };
  }
  try {
    return {
      failure: undefined,
      key: await unwrapKeyEnvelopesWithPrincipalPolicies({
        envelopes: input.wraps.map((wrap) => ({
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
 * addressed envelope additionally requires the current principal secret key.
 * Principal rotation rematerializes every retained container grant against
 * the new principal head, so a current reader never needs an older principal
 * key to use this recovery path. Unreachable principal keys fail closed with
 * `HistoricalWrapUnavailableError` rather than appearing to be corruption.
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

  const attempt = (wraps: typeof epochWraps) =>
    unwrapWrapsWithCurrentPolicies({
      execSql: input.execSql,
      secretKey: input.secretKey,
      wraps,
    });

  // A direct envelope is decryptable from identity keys alone, so its failure
  // means corruption — not an unreachable principal key. Neither failure ends
  // the search: a parent-container wrap may still anchor this epoch.
  //
  // Candidates are tried ONE AT A TIME, and each must match the epoch's
  // material-id commitment rather than merely decrypt. An envelope can be
  // AEAD-valid and still carry the WRONG key — a stale or misaddressed wrap —
  // so batching would let that one envelope answer for the whole group and
  // mask a later envelope that would have opened the epoch.
  const attemptCommitted = (candidates: ContainerKeyWrap[]) =>
    firstCommittedAnchor({
      attempt,
      candidates,
      containerId: input.containerId,
      containerKeyEpoch: input.epoch.containerKeyEpoch,
      containerKeyEpochId: input.epoch.containerKeyEpochId,
    });

  const direct = await attemptCommitted(directWraps);
  let keyMaterial = direct.key;
  const directFailure = direct.failure;
  let principalFailure: unknown;
  if (keyMaterial === null) {
    const principal = await attemptCommitted(principalWraps);
    keyMaterial = principal.key;
    // Preserve the current-policy failure in case no inherited anchor opens.
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
 * Rebuilds the container's keyring entries from the append-only bridge log —
 * the recovery path when a served keyring fails verification. Each link was
 * written once by the rotator that provably held both keys, so the walk
 * depends only on server-persisted state plus the current KEK; every
 * recovered key is checked against the material-id commitment its epoch id
 * carries. Returns entries for epochs 1..n-1 in ascending order, ready to
 * re-seal via a repair rekey.
 */

export { fetchContainerKekLog } from "./containerKekLogFetch";
export type {
  AggregatedContainerKekLog,
  KeyringRebuildResult,
} from "./keyringLogWalk";
export { rebuildKeyringEntriesFromLog } from "./keyringLogWalk";
