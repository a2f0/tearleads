import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import {
  ML_DSA87_PUBLIC_KEY_BYTES,
  ML_DSA87_SIGNATURE_BYTES,
} from "./generateKeyPair";

// Verifies an ML-DSA-87 signature against the original message bytes.
export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (
    signature.length !== ML_DSA87_SIGNATURE_BYTES ||
    publicKey.length !== ML_DSA87_PUBLIC_KEY_BYTES
  ) {
    return false;
  }

  try {
    return ml_dsa87.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
