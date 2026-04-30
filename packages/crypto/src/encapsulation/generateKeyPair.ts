import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { randomBytes } from "@noble/post-quantum/utils.js";

export const ML_KEM1024_PUBLIC_KEY_BYTES = 1568;
export const ML_KEM1024_SECRET_KEY_BYTES = 3168;
export const ML_KEM1024_CIPHERTEXT_BYTES = 1568;
export const ML_KEM1024_SEED_BYTES = 64;

// ML-KEM-1024 provides Level 5 security of NIST's Post-Quantum Cryptography standardization (FIPS 203).
export function generateKemKeyPair(seed: Uint8Array) {
  if (seed.length !== ML_KEM1024_SEED_BYTES) {
    throw new Error("ML-KEM-1024 seed must be 64 bytes");
  }

  return ml_kem1024.keygen(seed);
}

export function generateKemSeedAndKeyPair() {
  return generateKemKeyPair(randomBytes(ML_KEM1024_SEED_BYTES));
}
