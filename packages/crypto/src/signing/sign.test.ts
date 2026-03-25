import { expect, test } from "bun:test";
import { generateSeedAndKeyPair } from "./generateKeyPair";
import { sign, verify } from "./sign";

test("sign and verify round-trip", () => {
  const { publicKey, secretKey } = generateSeedAndKeyPair();
  const message = new TextEncoder().encode("hello");

  const signature = sign(message, secretKey);
  expect(verify(signature, message, publicKey)).toBe(true);
});

test("verify returns false with wrong public key", () => {
  const keys1 = generateSeedAndKeyPair();
  const keys2 = generateSeedAndKeyPair();
  const message = new TextEncoder().encode("hello");

  const signature = sign(message, keys1.secretKey);
  expect(verify(signature, message, keys2.publicKey)).toBe(false);
});

test("verify returns false with tampered message", () => {
  const { publicKey, secretKey } = generateSeedAndKeyPair();
  const message = new TextEncoder().encode("hello");
  const tampered = new TextEncoder().encode("world");

  const signature = sign(message, secretKey);
  expect(verify(signature, tampered, publicKey)).toBe(false);
});
