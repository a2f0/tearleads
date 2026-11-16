import { createHash, randomBytes } from "node:crypto";

// A test-only stand-in for ML-DSA-87 that keeps its observable contract at a
// fraction of the cost: the same key and signature lengths, deterministic key
// generation from a seed, randomized signing (two signatures of one message
// differ, as hedged ML-DSA's do), and verification that rejects any change to
// the message, signature, or public key.
//
// It is not a signature scheme. Anyone holding the public key can forge, so it
// must never reach production code; it only replaces the real primitive inside
// a test process through fastSignatures.testFixtures.ts.

const PUBLIC_KEY_BYTES = 2592;
const SECRET_KEY_BYTES = 4896;
const SIGNATURE_BYTES = 4627;
const SALT_BYTES = 32;
const SEED_BYTES = 32;

const encoder = new TextEncoder();
const SECRET_KEY_TAG = encoder.encode("tearleads.test.fast-ml-dsa87.sk");
const PUBLIC_KEY_TAG = encoder.encode("tearleads.test.fast-ml-dsa87.pk");
const SIGNATURE_TAG = encoder.encode("tearleads.test.fast-ml-dsa87.sig");

function shake256(outputLength: number, parts: readonly Uint8Array[]) {
  const hash = createHash("shake256", { outputLength });
  for (const part of parts) {
    hash.update(part);
  }
  return new Uint8Array(hash.digest());
}

function publicKeyOf(secretKey: Uint8Array): Uint8Array {
  return shake256(PUBLIC_KEY_BYTES, [PUBLIC_KEY_TAG, secretKey]);
}

function signatureBody(
  publicKey: Uint8Array,
  salt: Uint8Array,
  message: Uint8Array,
): Uint8Array {
  return shake256(SIGNATURE_BYTES - SALT_BYTES, [
    SIGNATURE_TAG,
    publicKey,
    salt,
    message,
  ]);
}

function keygen(seed: Uint8Array = new Uint8Array(randomBytes(SEED_BYTES))) {
  const secretKey = shake256(SECRET_KEY_BYTES, [SECRET_KEY_TAG, seed]);
  return { publicKey: publicKeyOf(secretKey), secretKey };
}

function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  if (secretKey.length !== SECRET_KEY_BYTES) {
    throw new Error("Fast ML-DSA-87 stand-in requires a 4896-byte secret key");
  }
  const salt = new Uint8Array(randomBytes(SALT_BYTES));
  const signature = new Uint8Array(SIGNATURE_BYTES);
  signature.set(salt);
  signature.set(
    signatureBody(publicKeyOf(secretKey), salt, message),
    SALT_BYTES,
  );
  return signature;
}

function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (
    signature.length !== SIGNATURE_BYTES ||
    publicKey.length !== PUBLIC_KEY_BYTES
  ) {
    return false;
  }
  const expected = signatureBody(
    publicKey,
    signature.subarray(0, SALT_BYTES),
    message,
  );
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= (signature[SALT_BYTES + index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}

export const fastMlDsa87 = { keygen, sign, verify } as const;
