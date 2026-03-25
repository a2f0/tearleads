import { expect, test } from "bun:test";
import {
  generateKemKeyPair,
  generateKemSeedAndKeyPair,
} from "./generateKeyPair";

test("same seed produces the same keypair", () => {
  const seed = new Uint8Array(64).fill(0xab);

  const keys1 = generateKemKeyPair(seed);
  const keys2 = generateKemKeyPair(seed);

  expect(keys1.publicKey).toEqual(keys2.publicKey);
  expect(keys1.secretKey).toEqual(keys2.secretKey);
});

test("different seed produces a different keypair", () => {
  const seed1 = new Uint8Array(64).fill(0xab);
  const seed2 = new Uint8Array(64).fill(0xcd);

  const keys1 = generateKemKeyPair(seed1);
  const keys2 = generateKemKeyPair(seed2);

  expect(keys1.publicKey).not.toEqual(keys2.publicKey);
  expect(keys1.secretKey).not.toEqual(keys2.secretKey);
});

test("generateKemSeedAndKeyPair produces unique keys each invocation", () => {
  const keys1 = generateKemSeedAndKeyPair();
  const keys2 = generateKemSeedAndKeyPair();

  expect(keys1.publicKey).not.toEqual(keys2.publicKey);
  expect(keys1.secretKey).not.toEqual(keys2.secretKey);
});
