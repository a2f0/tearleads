import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";

export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return ml_dsa87.verify(signature, message, publicKey);
}
