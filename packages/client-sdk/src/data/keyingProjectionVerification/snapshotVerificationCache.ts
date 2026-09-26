import {
  bytesToHex,
  createIncrementalSha256,
  verifyPrincipalPolicySnapshot,
} from "@tearleads/crypto";

type SnapshotInput = Parameters<typeof verifyPrincipalPolicySnapshot>[0];
type SnapshotResult = Awaited<ReturnType<typeof verifyPrincipalPolicySnapshot>>;

// Bind independently decoded responses to their actual bytes, reference, trusted
// signer keys and external authority. Checkpoints remain checked by the caller.
const verified = new Map<string, SnapshotResult>();
const MAX_CACHED_SOURCE_CHARACTERS = 4_000_000;
const MAX_ENTRIES = 16;

function freezeResult(value: object): void {
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null && !Object.isFrozen(child))
      freezeResult(child);
  }
  Object.freeze(value);
}

export async function verifyReceivedPolicySnapshot(
  input: SnapshotInput,
): Promise<SnapshotResult> {
  const source = JSON.stringify(input);
  if (source.length > MAX_CACHED_SOURCE_CHARACTERS)
    return verifyPrincipalPolicySnapshot(input);
  const hash = createIncrementalSha256();
  hash.update(new TextEncoder().encode(source));
  const key = bytesToHex(hash.digest());
  const cached = verified.get(key);
  if (cached) {
    verified.delete(key);
    verified.set(key, cached);
    return cached;
  }
  const result = await verifyPrincipalPolicySnapshot(structuredClone(input));
  if (result.ok) {
    freezeResult(result);
    verified.set(key, result);
    while (verified.size > MAX_ENTRIES) {
      const oldest = verified.keys().next().value;
      if (oldest !== undefined) verified.delete(oldest);
    }
  }
  return result;
}
