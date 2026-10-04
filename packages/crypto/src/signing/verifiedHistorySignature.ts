import { bytesToHex } from "../hex";
import { createIncrementalSha256 } from "../incrementalSha256";
import { verify } from "./verify";

export function signatureVerificationDigest(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  const hash = createIncrementalSha256();
  for (const bytes of [signature, message, publicKey]) {
    const length = new Uint8Array(8);
    new DataView(length.buffer).setBigUint64(0, BigInt(bytes.byteLength));
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest();
}

/** Only signature mathematics is memoized. Authorization and checkpoints always run. */
export function createHistorySignatureVerifier(
  verifySignature = verify,
  capacity = 8192,
) {
  const accepted = new Set<string>();
  const check = (
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ): boolean => {
    const key = bytesToHex(
      signatureVerificationDigest(signature, message, publicKey),
    );
    if (accepted.delete(key)) {
      accepted.add(key);
      return true;
    }
    if (!verifySignature(signature, message, publicKey)) return false;
    accepted.add(key);
    while (accepted.size > capacity) {
      const oldest = accepted.values().next().value;
      if (oldest === undefined) break;
      accepted.delete(oldest);
    }
    return true;
  };
  return Object.assign(check, { clear: () => accepted.clear() });
}

export const verifyHistorySignature = createHistorySignatureVerifier();
