import { verifyPrincipalPolicySnapshot } from "@tearleads/crypto";
import { ByteBudgetCache } from "../../utils/byteBudgetCache";
import { beginPrincipalHistoryVerification } from "../../utils/principalHistoryWork";
import { sha256Hex } from "../../utils/sha256";

type SnapshotResult = Awaited<ReturnType<typeof verifyPrincipalPolicySnapshot>>;
const snapshots = new ByteBudgetCache<SnapshotResult>(32 * 1024 * 1024);
const MAX_CACHED_SOURCE_CHARACTERS = 4_000_000;

function freezeResult(value: object): void {
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null && !Object.isFrozen(child))
      freezeResult(child);
  }
  Object.freeze(value);
}

/** Recheck the actual source and signer keys, not just its claimed state hash. */
export async function verifyStoredPolicySnapshot(
  input: Parameters<typeof verifyPrincipalPolicySnapshot>[0],
): ReturnType<typeof verifyPrincipalPolicySnapshot> {
  beginPrincipalHistoryVerification();
  const source = JSON.stringify(input);
  if (source.length > MAX_CACHED_SOURCE_CHARACTERS)
    return verifyPrincipalPolicySnapshot(input);
  const key = sha256Hex(source);
  const cached = snapshots.get(key);
  if (cached) return cached;
  const result = await verifyPrincipalPolicySnapshot(structuredClone(input));
  if (result.ok) {
    freezeResult(result);
    // Charge both string storage and object/array overhead conservatively.
    snapshots.set(key, result, JSON.stringify(result).length * 4);
  }
  return result;
}

/** Discard volatile hints when exercising cold verification after process loss. */
export function clearStoredPolicySnapshotCache(): void {
  snapshots.clear();
}
