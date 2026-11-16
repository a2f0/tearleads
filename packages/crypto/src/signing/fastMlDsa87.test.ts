import { expect, test } from "bun:test";
import { fastMlDsa87 } from "./fastMlDsa87.testFixtures";
import {
  generateSigningKeyPair,
  ML_DSA87_PUBLIC_KEY_BYTES,
  ML_DSA87_SECRET_KEY_BYTES,
  ML_DSA87_SIGNATURE_BYTES,
} from "./generateKeyPair";
import { sign } from "./sign";
import { verify } from "./verify";

// This package has no test preload, so these run against real ML-DSA-87: the
// stand-in and the real primitive must never accept each other's signatures,
// or a stand-in run could hide a mixed-primitive path.

const message = new TextEncoder().encode("tearleads fast signature control");
const seed = new Uint8Array(32).fill(7);

test("real verify rejects a stand-in signature", () => {
  const real = generateSigningKeyPair(seed);
  const standInSignature = fastMlDsa87.sign(message, real.signingPrivateKey);

  expect(verify(standInSignature, message, real.signingPublicKey)).toBe(false);

  const standIn = fastMlDsa87.keygen(seed);
  expect(
    verify(
      fastMlDsa87.sign(message, standIn.secretKey),
      message,
      standIn.publicKey,
    ),
  ).toBe(false);
});

test("stand-in verify rejects a real signature", () => {
  const real = generateSigningKeyPair(seed);
  const realSignature = sign(message, real.signingPrivateKey);

  expect(verify(realSignature, message, real.signingPublicKey)).toBe(true);
  expect(
    fastMlDsa87.verify(realSignature, message, real.signingPublicKey),
  ).toBe(false);
});

test("stand-in keeps ML-DSA-87 lengths, seeded keys, and hedged signing", () => {
  const keys = fastMlDsa87.keygen(seed);
  expect(keys.publicKey).toHaveLength(ML_DSA87_PUBLIC_KEY_BYTES);
  expect(keys.secretKey).toHaveLength(ML_DSA87_SECRET_KEY_BYTES);
  expect(fastMlDsa87.keygen(seed)).toEqual(keys);
  expect(fastMlDsa87.keygen(new Uint8Array(32).fill(8))).not.toEqual(keys);

  const first = fastMlDsa87.sign(message, keys.secretKey);
  const second = fastMlDsa87.sign(message, keys.secretKey);
  expect(first).toHaveLength(ML_DSA87_SIGNATURE_BYTES);
  expect(first).not.toEqual(second);
  expect(fastMlDsa87.verify(first, message, keys.publicKey)).toBe(true);
  expect(fastMlDsa87.verify(second, message, keys.publicKey)).toBe(true);
});

test("stand-in verify rejects a changed message, signature, or key", () => {
  const keys = fastMlDsa87.keygen(seed);
  const signature = fastMlDsa87.sign(message, keys.secretKey);

  const changedMessage = message.slice();
  changedMessage[0] = (changedMessage[0] ?? 0) ^ 1;
  expect(fastMlDsa87.verify(signature, changedMessage, keys.publicKey)).toBe(
    false,
  );

  for (const index of [0, signature.length - 1]) {
    const changedSignature = signature.slice();
    changedSignature[index] = (changedSignature[index] ?? 0) ^ 1;
    expect(fastMlDsa87.verify(changedSignature, message, keys.publicKey)).toBe(
      false,
    );
  }

  const otherKey = fastMlDsa87.keygen(new Uint8Array(32).fill(9)).publicKey;
  expect(fastMlDsa87.verify(signature, message, otherKey)).toBe(false);
});
