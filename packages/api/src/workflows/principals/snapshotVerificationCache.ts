import {
  type VerifiedPrincipalPolicySnapshot,
  verifyPrincipalPolicySnapshot,
} from "@tearleads/crypto";
import { StoredVerificationCache } from "../../utils/storedVerificationCache";

// Keep the cache bounded even when an organization has a long retained chain.
const snapshots = new StoredVerificationCache<VerifiedPrincipalPolicySnapshot>(
  16,
);
const MAX_CACHED_SOURCE_CHARACTERS = 4_000_000;

/** Recheck the actual source and signer keys, not just its claimed state hash. */
export async function verifyStoredPolicySnapshot(
  input: Parameters<typeof verifyPrincipalPolicySnapshot>[0],
): ReturnType<typeof verifyPrincipalPolicySnapshot> {
  const key = input.snapshot.currentState.stateHash;
  const source = JSON.stringify(input);
  if (source.length > MAX_CACHED_SOURCE_CHARACTERS)
    return verifyPrincipalPolicySnapshot(input);
  const cached = snapshots.get(key, source);
  if (cached) return { ok: true, value: structuredClone(cached) };
  const result = await verifyPrincipalPolicySnapshot(input);
  if (result.ok) snapshots.set(key, source, structuredClone(result.value));
  return result;
}
