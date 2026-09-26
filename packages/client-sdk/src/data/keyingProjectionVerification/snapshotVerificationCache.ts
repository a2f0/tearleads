import { verifyPrincipalPolicySnapshot } from "@tearleads/crypto";

type SnapshotInput = Parameters<typeof verifyPrincipalPolicySnapshot>[0];
type SnapshotResult = Awaited<ReturnType<typeof verifyPrincipalPolicySnapshot>>;

// A document's paths reuse the same proof objects. Weak keys keep memoized work
// within their lifetime; changed bytes, trusted signer keys, or authority miss.
const verified = new WeakMap<
  SnapshotInput["snapshot"],
  {
    source: string;
    result: SnapshotResult;
  }
>();
const MAX_CACHED_SOURCE_CHARACTERS = 4_000_000;

export async function verifyReceivedPolicySnapshot(
  input: SnapshotInput,
): Promise<SnapshotResult> {
  const source = JSON.stringify(input);
  if (source.length > MAX_CACHED_SOURCE_CHARACTERS)
    return verifyPrincipalPolicySnapshot(input);
  const cached = verified.get(input.snapshot);
  if (cached?.source === source) return structuredClone(cached.result);
  const result = await verifyPrincipalPolicySnapshot(input);
  if (result.ok)
    verified.set(input.snapshot, { source, result: structuredClone(result) });
  return result;
}
