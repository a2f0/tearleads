import { bytesToHex } from "../hex";
import { createIncrementalSha256 } from "../incrementalSha256";
import {
  signatureVerificationDigest,
  verifyHistorySignature,
} from "./verifiedHistorySignature";

interface SignatureInput {
  readonly signature: Uint8Array;
  readonly message: Uint8Array;
  readonly publicKey: Uint8Array;
}

const DOMAIN = new TextEncoder().encode("tearleads.signature-history.v1");

function remember(accepted: Set<string>, key: string, capacity: number): void {
  accepted.delete(key);
  accepted.add(key);
  while (accepted.size > capacity) {
    const oldest = accepted.values().next().value;
    if (oldest === undefined) break;
    accepted.delete(oldest);
  }
}

/**
 * Retain only digests of locally verified signature transcripts. Re-hash every
 * supplied byte before reusing a prefix; no authorization or server head is
 * cached. This avoids LRU scan thrashing when one history exceeds the per-entry
 * signature cache. The two passes retain only one digest per input, not proofs.
 */
export function createSignatureHistoryVerifier(
  verifySignature: (
    ...args: Parameters<typeof verifyHistorySignature>
  ) => boolean = verifyHistorySignature,
  capacity = 128,
) {
  const accepted = new Set<string>();
  const check = async (
    entries: () => AsyncIterable<SignatureInput>,
  ): Promise<boolean> => {
    const digests: string[] = [];
    let prefix = DOMAIN;
    let verifiedThrough = 0;
    for await (const entry of entries()) {
      const digest = signatureVerificationDigest(
        entry.signature,
        entry.message,
        entry.publicKey,
      );
      digests.push(bytesToHex(digest));
      const hash = createIncrementalSha256();
      hash.update(prefix);
      hash.update(digest);
      prefix = hash.digest();
      const key = bytesToHex(prefix);
      if (accepted.delete(key)) {
        accepted.add(key);
        verifiedThrough = digests.length;
      }
    }
    let index = 0;
    for await (const entry of entries()) {
      // A provider changing its input between passes must never make a cached
      // prefix cover different bytes, nor add/remove an unchecked signature.
      if (
        digests[index] !==
        bytesToHex(
          signatureVerificationDigest(
            entry.signature,
            entry.message,
            entry.publicKey,
          ),
        )
      )
        return false;
      if (
        index >= verifiedThrough &&
        !verifySignature(entry.signature, entry.message, entry.publicKey)
      )
        return false;
      index += 1;
    }
    if (index !== digests.length) return false;
    const key = bytesToHex(prefix);
    remember(accepted, key, capacity);
    return true;
  };
  return Object.assign(check, { clear: () => accepted.clear() });
}
