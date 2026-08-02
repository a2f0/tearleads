import {
  type ContainerKeyWrap,
  computeContainerKekMaterialId,
  decryptWithDek,
  unwrapDek,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type {
  PrincipalPolicyHistoryEntryResponse,
  PrincipalPolicyHistoryResponse,
} from "@tearleads/validators/response";
import { MAX_PRINCIPAL_STATE_VERSION } from "@tearleads/validators/util";

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
 * Verifies that a page's entries chain, and that the chain reaches the entry
 * being used.
 *
 * Each state names its predecessor by `prevStateHash`, so a page served
 * newest-first must have every entry's `prevStateHash` equal to the next
 * entry's `stateHash`. Checking this before trusting an entry's envelopes is
 * what stops a server from splicing a fabricated state — with a key it chose —
 * into the history and having a client unwrap a container KEK under it.
 *
 * Page boundaries are unavoidably weaker: the oldest entry of one page is
 * checked against the newest of the next only when both are seen, which the
 * cursor walk below does by carrying the boundary forward.
 */
function isChainedPage(
  entries: readonly PrincipalPolicyHistoryEntryResponse[],
  expectedNewestStateHash: string | null,
): boolean {
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
async function keyFromPage(
  entries: readonly PrincipalPolicyHistoryEntryResponse[],
  keyFingerprint: string,
  secretKey: Uint8Array,
): Promise<Uint8Array | null> {
  for (const entry of entries) {
    if (entry.state.keyFingerprint !== keyFingerprint) {
      continue;
    }
    try {
      return await unwrapDek(
        entry.memberEnvelopes.map((envelope) => ({
          keyFingerprint: envelope.memberKeyFingerprint,
          kemCipherText: base64ToBytes(envelope.kemCipherText),
          wrappedKey: base64ToBytes(envelope.wrappedKey),
        })),
        secretKey,
      );
    } catch {
      // Keep scanning this page.
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
}): Promise<Uint8Array | null> {
  let beforeVersion: number | undefined;
  let expectedNewestStateHash: string | null = null;
  let pages = 0;
  // The walk is bounded by the same ceiling the server enforces on a cursor,
  // so a server that always claims more cannot spin it forever.
  const maxPages = 64;

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
    if (!isChainedPage(page.entries, expectedNewestStateHash)) {
      return null;
    }

    const fromPage = await keyFromPage(
      page.entries,
      input.keyFingerprint,
      input.secretKey,
    );
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
