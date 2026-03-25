import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { randomBytes } from "@noble/post-quantum/utils.js";

// ML-KEM-1024 provides Level 5 security of NIST's Post-Quantum Cryptography standardization (FIPS 203).
export function generateKemKeyPair(seed: Uint8Array) {
  return ml_kem1024.keygen(seed);
}

export function generateKemSeedAndKeyPair() {
  return generateKemKeyPair(randomBytes(64));
}
