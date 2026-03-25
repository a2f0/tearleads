import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { randomBytes } from "@noble/post-quantum/utils.js";

interface SigningKeyPair {
  signingPublicKey: Uint8Array;
  signingPrivateKey: Uint8Array;
}

// ML-DSA-87 provides Level 5 security of NIST's Post-Quantum Cryptography standardization (FIPS 204).
export function generateSigningKeyPair(seed: Uint8Array): SigningKeyPair {
  const { publicKey, secretKey } = ml_dsa87.keygen(seed);
  return { signingPublicKey: publicKey, signingPrivateKey: secretKey };
}

export function generateSigningSeedAndKeyPair(): SigningKeyPair {
  return generateSigningKeyPair(randomBytes(32));
}
