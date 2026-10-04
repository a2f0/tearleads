import { bytesToHex } from "../hex";
import { createIncrementalSha256 } from "../incrementalSha256";
import { verify } from "./verify";

/** Only signature mathematics is memoized. Authorization and checkpoints always run. */
export function createHistorySignatureVerifier(
  verifySignature = verify,
  capacity = 8192,
) {
  const accepted = new Set<string>();
  return (
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ): boolean => {
    const hash = createIncrementalSha256();
    for (const bytes of [signature, message, publicKey]) {
      const length = new Uint8Array(8);
      new DataView(length.buffer).setBigUint64(0, BigInt(bytes.byteLength));
      hash.update(length);
      hash.update(bytes);
    }
    const key = bytesToHex(hash.digest());
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
}

export const verifyHistorySignature = createHistorySignatureVerifier();
