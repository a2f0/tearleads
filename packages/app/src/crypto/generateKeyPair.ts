import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { randomBytes } from "@noble/post-quantum/utils.js";

export function generateKeyPair(seed: Uint8Array) {
  return ml_dsa87.keygen(seed);
}

export function generateSeedAndKeyPair() {
  return generateKeyPair(randomBytes(32));
}
