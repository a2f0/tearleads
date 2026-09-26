import { verifyPrincipalPolicySnapshot } from "@tearleads/crypto";
import { sha256Hex } from "../../utils/sha256";

type SnapshotResult = Awaited<ReturnType<typeof verifyPrincipalPolicySnapshot>>;
const snapshots = new Map<string, SnapshotResult>();
const MAX_CACHED_SOURCE_CHARACTERS = 4_000_000;
const MAX_ENTRIES = 16;

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
  const source = JSON.stringify(input);
  if (source.length > MAX_CACHED_SOURCE_CHARACTERS)
    return verifyPrincipalPolicySnapshot(input);
  const key = sha256Hex(source);
  const cached = snapshots.get(key);
  if (cached) {
    snapshots.delete(key);
    snapshots.set(key, cached);
    return cached;
  }
  const result = await verifyPrincipalPolicySnapshot(structuredClone(input));
  if (result.ok) {
    freezeResult(result);
    snapshots.set(key, result);
    while (snapshots.size > MAX_ENTRIES) {
      const oldest = snapshots.keys().next().value;
      if (oldest !== undefined) snapshots.delete(oldest);
    }
  }
  return result;
}
