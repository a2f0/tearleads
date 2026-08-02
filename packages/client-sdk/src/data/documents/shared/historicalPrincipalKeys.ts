import {
  type ContainerKeyWrap,
  computeContainerKekMaterialId,
  computePrincipalStateHash,
  decryptWithDek,
  unwrapDek,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  PrincipalPolicyHistoryEntryResponse,
  PrincipalPolicyHistoryResponse,
} from "@tearleads/validators/response";
import {
  MAX_PRINCIPAL_STATE_VERSION,
  PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT,
} from "@tearleads/validators/util";

/**
 * Fetches one page of a principal's policy history, newest first.
 *
 * Injected rather than imported so the recovery walk stays testable without an
 * HTTP client, mirroring `fetchContainerKekLog`.
 */
export type PrincipalPolicyHistoryFetcher = (input: {
  beforeVersion?: number;
  principalId: string;
  principalType: "group" | "organization";
}) => Promise<PrincipalPolicyHistoryResponse | null>;

/**
 * Verifies that a page's entries chain, and that each claimed state hash is
 * the hash of the state it labels.
 *
 * Recomputing the hash is what makes the linkage mean anything: comparing the
 * server's own `prevStateHash` string against its own `stateHash` string is
 * self-consistent for any fabricated pair, so without recomputation the check
 * would be theatre.
 *
 * What this does NOT do is verify each state's signature against its signer's
 * identity key — that needs the trusted-identity gateway threaded into the
 * recovery walk, and is tracked separately. The outcome is still safe without
 * it: a recovered principal key only matters if it opens a container envelope
 * AND the resulting container key matches that epoch's material-id commitment,
 * so a fabricated chain costs a failed recovery, never a wrong key admitted
 * into a keyring.
 */
async function isChainedPage(
  entries: readonly PrincipalPolicyHistoryEntryResponse[],
  expectedNewestStateHash: string | null,
): Promise<boolean> {
  const newest = entries[0];
  if (!newest) {
    return true;
  }
  if (
    expectedNewestStateHash !== null &&
    newest.state.stateHash !== expectedNewestStateHash
  ) {
    return false;
  }
  for (const [index, entry] of entries.entries()) {
    if (
      (await computePrincipalStateHash(entry.state)) !== entry.state.stateHash
    ) {
      return false;
    }
    const older = entries[index + 1];
    if (!older) {
      continue;
    }
    if (entry.state.prevStateHash !== older.state.stateHash) {
      return false;
    }
  }
  return true;
}

/**
 * Recovers a principal's secret key at the epoch a historical envelope was
 * addressed to.
 *
 * This is the counterpart to the container kek-log backstop. A container
 * envelope addressed to a group names the group key epoch it was sealed to; a
 * client that joined later, or that has only the group's CURRENT key, cannot
 * open it from current policy alone. Walking the principal's own signed state
 * history back to the matching `keyFingerprint` supplies that key.
 *
 * Returns null rather than throwing when the fingerprint is unreachable: the
 * caller has other anchors to try, and an unreachable historical key is a
 * bounded recovery outcome, not an error. A group that has been DELETED purges
 * its states and envelopes outright, so no walk can recover it — that case is
 * permanently unrecoverable by design.
 */
/**
 * The principal key from whichever entry on this page was sealed under the
 * requested fingerprint.
 *
 * A fingerprint match whose envelopes do not open is not a failure: the
 * requester reached the principal through a group at that time rather than
 * directly, and an older state may still carry a direct envelope.
 */
async function keyFromPage(input: {
  entries: readonly PrincipalPolicyHistoryEntryResponse[];
  fetchHistory: PrincipalPolicyHistoryFetcher;
  keyFingerprint: string;
  secretKey: Uint8Array;
  visiting: ReadonlySet<string>;
}): Promise<Uint8Array | null> {
  for (const entry of input.entries) {
    if (entry.state.keyFingerprint !== input.keyFingerprint) {
      continue;
    }
    try {
      return await unwrapDek(
        entry.memberEnvelopes.map((envelope) => ({
          keyFingerprint: envelope.memberKeyFingerprint,
          kemCipherText: base64ToBytes(envelope.kemCipherText),
          wrappedKey: base64ToBytes(envelope.wrappedKey),
        })),
        input.secretKey,
      );
    } catch {
      // The identity key opens none of them. The requester may still reach
      // this principal transitively — through a group that is itself a member
      // here — so try each group-addressed envelope by recovering that
      // group's key at the epoch the envelope names.
      const nested = await keyThroughNestedGroup({
        entry,
        fetchHistory: input.fetchHistory,
        secretKey: input.secretKey,
        visiting: input.visiting,
      });
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

/**
 * Opens one state's group-addressed envelopes by recovering the nested group's
 * own key at the epoch each envelope names.
 *
 * Membership is transitive, so a container envelope sealed to an outer group
 * can be reachable only through an inner one. Each hop is the same walk
 * applied to a different principal, with `visiting` breaking cycles a hostile
 * server could otherwise use to make the recursion run forever.
 */
async function keyThroughNestedGroup(input: {
  entry: PrincipalPolicyHistoryEntryResponse;
  fetchHistory: PrincipalPolicyHistoryFetcher;
  secretKey: Uint8Array;
  visiting: ReadonlySet<string>;
}): Promise<Uint8Array | null> {
  for (const envelope of input.entry.memberEnvelopes) {
    if (envelope.memberPrincipalType !== "group") {
      continue;
    }
    const nestedKey = `group:${envelope.memberPrincipalId}`;
    if (input.visiting.has(nestedKey)) {
      continue;
    }
    const nestedSecret = await resolveHistoricalPrincipalKey({
      fetchHistory: input.fetchHistory,
      keyFingerprint: envelope.memberKeyFingerprint,
      principalId: envelope.memberPrincipalId,
      principalType: "group",
      secretKey: input.secretKey,
      visiting: new Set([...input.visiting, nestedKey]),
    });
    if (!nestedSecret) {
      continue;
    }
    try {
      return await unwrapDek(
        [
          {
            keyFingerprint: envelope.memberKeyFingerprint,
            kemCipherText: base64ToBytes(envelope.kemCipherText),
            wrappedKey: base64ToBytes(envelope.wrappedKey),
          },
        ],
        nestedSecret,
      );
    } catch {
      // This hop did not open it; another member envelope may.
    }
  }
  return null;
}

export async function resolveHistoricalPrincipalKey(input: {
  fetchHistory: PrincipalPolicyHistoryFetcher;
  keyFingerprint: string;
  principalId: string;
  principalType: "group" | "organization";
  secretKey: Uint8Array;
  /** Principals already on the recursion path; breaks membership cycles. */
  visiting?: ReadonlySet<string> | undefined;
}): Promise<Uint8Array | null> {
  const visiting =
    input.visiting ?? new Set([`${input.principalType}:${input.principalId}`]);
  let beforeVersion: number | undefined;
  let expectedNewestStateHash: string | null = null;
  let pages = 0;
  // Derived from the wire bounds, not a magic number: a principal may hold up
  // to MAX_PRINCIPAL_STATE_VERSION states and each page carries at most
  // PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT of them, so anything smaller would
  // make legitimately old keys unreachable. The bound still exists so a server
  // that always claims more cannot spin the walk forever.
  const maxPages =
    Math.ceil(
      MAX_PRINCIPAL_STATE_VERSION / PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT,
    ) + 1;

  while (pages < maxPages) {
    pages += 1;
    const page = await input.fetchHistory({
      principalId: input.principalId,
      principalType: input.principalType,
      ...(beforeVersion === undefined ? {} : { beforeVersion }),
    });
    if (!page || page.entries.length === 0) {
      return null;
    }
    if (
      page.principalId !== input.principalId ||
      page.principalType !== input.principalType
    ) {
      return null;
    }
    if (!(await isChainedPage(page.entries, expectedNewestStateHash))) {
      return null;
    }

    const fromPage = await keyFromPage({
      entries: page.entries,
      fetchHistory: input.fetchHistory,
      keyFingerprint: input.keyFingerprint,
      secretKey: input.secretKey,
      visiting,
    });
    if (fromPage) {
      return fromPage;
    }

    const oldest = page.entries.at(-1);
    if (!page.hasMore || !oldest) {
      return null;
    }
    // Carry the boundary forward so the next page's newest entry is checked
    // against this page's oldest, closing the per-page chain gap.
    expectedNewestStateHash = oldest.state.prevStateHash;
    beforeVersion = oldest.state.version;
    if (beforeVersion <= 1 || beforeVersion > MAX_PRINCIPAL_STATE_VERSION) {
      return null;
    }
  }
  return null;
}

/**
 * Opens a principal-addressed container envelope using the principal's own
 * signed policy history.
 *
 * Each candidate names both the principal (`recipientKind` + `recipientId`)
 * and the exact key epoch it was sealed to (`recipientKeyFingerprint`), which
 * is what makes the lookup possible at all: the envelope alone carries no
 * principal identity, so this cannot live inside the generic envelope
 * resolver.
 *
 * The recovered key is checked against the epoch's material-id commitment by
 * the caller, so a history walk that returns the wrong key cannot promote it
 * into the keyring.
 */
export async function openPrincipalWrapsThroughHistory(input: {
  containerKeyEpoch: number;
  containerKeyEpochId: string;
  containerId: string;
  fetchHistory?: PrincipalPolicyHistoryFetcher | undefined;
  principalWraps: readonly ContainerKeyWrap[];
  secretKey: Uint8Array;
}): Promise<Uint8Array | null> {
  const fetchHistory = input.fetchHistory;
  if (!fetchHistory) {
    return null;
  }

  for (const wrap of input.principalWraps) {
    if (
      wrap.recipientKind !== "group" &&
      wrap.recipientKind !== "organization"
    ) {
      continue;
    }
    const principalKey = await resolveHistoricalPrincipalKey({
      fetchHistory,
      keyFingerprint: wrap.recipientKeyFingerprint,
      principalId: wrap.recipientId,
      principalType: wrap.recipientKind,
      secretKey: input.secretKey,
    });
    if (!principalKey) {
      continue;
    }
    try {
      const containerKey = await decryptWithDek(
        {
          iv: base64ToBytes(wrap.kemCipherText),
          ciphertext: base64ToBytes(wrap.wrappedKey),
        },
        principalKey,
      );
      const materialId = await computeContainerKekMaterialId({
        containerId: input.containerId,
        keyEpoch: input.containerKeyEpoch,
        keyMaterial: containerKey,
      });
      if (materialId === input.containerKeyEpochId) {
        return containerKey;
      }
    } catch {
      // A recovered principal key that does not open this envelope means the
      // fingerprint matched a state whose envelope was addressed elsewhere.
      // Other candidates may still work.
    }
  }
  return null;
}
