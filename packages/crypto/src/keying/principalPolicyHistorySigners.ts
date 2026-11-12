import { compareCanonicalStrings } from "../canonicalOrdering";
import type { NormalizedPrincipalPolicyStateChainEntry } from "./principalPolicyTypes";
import {
  assertExactKeys,
  readNullableHashString,
  readString,
  throwVerification,
} from "./shared";

/**
 * A signer of an accepted history state, with the identity bundle its
 * predecessor's signed projection committed for it or, with no predecessor
 * listing it (a founder), the bundle its own signed projection commits.
 * Null for a signer in neither: an external authority, whose Admins policy
 * commits it. Callers pin these only once the history reaches its head.
 */
export interface PrincipalHistorySigner {
  readonly userId: string;
  readonly signingKeyFingerprint: string;
  readonly identityBundleFingerprint: string | null;
}

/** Distinct signers a verifier may carry; far above any real group's. */
const PRINCIPAL_HISTORY_SIGNER_LIMIT = 4096;

function signerKey(signer: PrincipalHistorySigner): string {
  return `${signer.userId}\u0000${signer.signingKeyFingerprint}\u0000${signer.identityBundleFingerprint ?? ""}`;
}

function committedBundle(
  entry: NormalizedPrincipalPolicyStateChainEntry | undefined,
  userId: string,
): string | undefined {
  return entry?.projection.find((member) => member.userId === userId)
    ?.identityBundleFingerprint;
}

/**
 * The signer record after accepting `entries`, which the chain verifier has
 * already linked to `previous`: a new map, so a refused page changes nothing.
 */
export function recordAcceptedSigners(
  recorded: ReadonlyMap<string, PrincipalHistorySigner>,
  previous: NormalizedPrincipalPolicyStateChainEntry | undefined,
  entries: readonly NormalizedPrincipalPolicyStateChainEntry[],
): Map<string, PrincipalHistorySigner> {
  const signers = new Map(recorded);
  let predecessor = previous;
  for (const entry of entries) {
    const { signerUserId: userId, signerUserKeyFingerprint } = entry.state;
    const signer = {
      userId,
      signingKeyFingerprint: signerUserKeyFingerprint,
      identityBundleFingerprint:
        committedBundle(predecessor, userId) ??
        committedBundle(entry, userId) ??
        null,
    };
    signers.set(signerKey(signer), signer);
    predecessor = entry;
  }
  if (signers.size > PRINCIPAL_HISTORY_SIGNER_LIMIT)
    throwVerification(
      "invalid_shape",
      "principal history has too many distinct signers",
    );
  return signers;
}

/** Canonically ordered owned copies, for sealed progress and finish(). */
export function captureHistorySigners(
  signers: ReadonlyMap<string, PrincipalHistorySigner>,
): PrincipalHistorySigner[] {
  return [...signers.entries()]
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
    .map(([, signer]) => ({ ...signer }));
}

/** Restore authenticated progress's signers: exact, unique, canonical. */
export function normalizeHistorySigners(
  value: unknown,
): Map<string, PrincipalHistorySigner> {
  if (!Array.isArray(value) || value.length > PRINCIPAL_HISTORY_SIGNER_LIMIT)
    throwVerification("invalid_shape", "invalid saved principal signers");
  const signers = new Map<string, PrincipalHistorySigner>();
  let last: string | null = null;
  for (const item of value) {
    const record = assertExactKeys(
      item,
      ["userId", "signingKeyFingerprint", "identityBundleFingerprint"],
      "principal history signer",
    );
    const signer = {
      userId: readString(record, "userId", "principal history signer"),
      signingKeyFingerprint: readString(
        record,
        "signingKeyFingerprint",
        "principal history signer",
      ),
      identityBundleFingerprint: readNullableHashString(
        record,
        "identityBundleFingerprint",
        "principal history signer",
      ),
    };
    const key = signerKey(signer);
    if (last !== null && compareCanonicalStrings(last, key) >= 0)
      throwVerification(
        "invalid_shape",
        "saved principal signers are not unique and ordered",
      );
    last = key;
    signers.set(key, signer);
  }
  return signers;
}
