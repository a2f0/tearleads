import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { randomBytes } from "@noble/post-quantum/utils.js";

export interface SigningKeyPair {
  readonly signingPublicKey: Uint8Array;
  readonly signingPrivateKey: Uint8Array;
}

export const ML_DSA87_PUBLIC_KEY_BYTES = 2592;
export const ML_DSA87_SECRET_KEY_BYTES = 4896;
export const ML_DSA87_SIGNATURE_BYTES = 4627;

// ML-DSA-87 provides Level 5 security of NIST's Post-Quantum Cryptography standardization (FIPS 204).
export function generateSigningKeyPair(seed: Uint8Array): SigningKeyPair {
  if (seed.length !== 32) {
    throw new Error("ML-DSA-87 signing seed must be 32 bytes");
  }

  const { publicKey, secretKey } = ml_dsa87.keygen(seed);
  return { signingPublicKey: publicKey, signingPrivateKey: secretKey };
}

export function generateSigningSeedAndKeyPair(): SigningKeyPair {
  return generateSigningKeyPair(randomBytes(32));
}
