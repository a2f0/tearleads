import { expect, test } from "bun:test";
import {
  generateSigningKeyPair,
  generateSigningSeedAndKeyPair,
} from "./generateKeyPair";

test("same seed produces the same keypair", () => {
  const seed = new Uint8Array(32).fill(0xab);

  const keys1 = generateSigningKeyPair(seed);
  const keys2 = generateSigningKeyPair(seed);

  expect(keys1.signingPublicKey).toEqual(keys2.signingPublicKey);
  expect(keys1.signingPrivateKey).toEqual(keys2.signingPrivateKey);
});

test("different seed produces a different keypair", () => {
  const seed1 = new Uint8Array(32).fill(0xab);
  const seed2 = new Uint8Array(32).fill(0xcd);

  const keys1 = generateSigningKeyPair(seed1);
  const keys2 = generateSigningKeyPair(seed2);

  expect(keys1.signingPublicKey).not.toEqual(keys2.signingPublicKey);
  expect(keys1.signingPrivateKey).not.toEqual(keys2.signingPrivateKey);
});

test("generateSigningSeedAndKeyPair produces unique keys each invocation", () => {
  const keys1 = generateSigningSeedAndKeyPair();
  const keys2 = generateSigningSeedAndKeyPair();

  expect(keys1.signingPublicKey).not.toEqual(keys2.signingPublicKey);
  expect(keys1.signingPrivateKey).not.toEqual(keys2.signingPrivateKey);
});
