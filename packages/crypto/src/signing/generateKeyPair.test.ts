import { expect, test } from "bun:test";
import { generateKeyPair, generateSeedAndKeyPair } from "./generateKeyPair";

test("same seed produces the same keypair", () => {
  const seed = new Uint8Array(32).fill(0xab);

  const keys1 = generateKeyPair(seed);
  const keys2 = generateKeyPair(seed);

  expect(keys1.publicKey).toEqual(keys2.publicKey);
  expect(keys1.secretKey).toEqual(keys2.secretKey);
});

test("different seed produces a different keypair", () => {
  const seed1 = new Uint8Array(32).fill(0xab);
  const seed2 = new Uint8Array(32).fill(0xcd);

  const keys1 = generateKeyPair(seed1);
  const keys2 = generateKeyPair(seed2);

  expect(keys1.publicKey).not.toEqual(keys2.publicKey);
  expect(keys1.secretKey).not.toEqual(keys2.secretKey);
});

test("generateSeedAndKeyPair produces unique keys each invocation", () => {
  const keys1 = generateSeedAndKeyPair();
  const keys2 = generateSeedAndKeyPair();

  expect(keys1.publicKey).not.toEqual(keys2.publicKey);
  expect(keys1.secretKey).not.toEqual(keys2.secretKey);
});
