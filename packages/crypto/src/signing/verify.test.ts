import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "./generateKeyPair";
import { sign } from "./sign";
import { verify } from "./verify";

test("verify returns false with wrong public key", () => {
  const keys1 = generateSigningSeedAndKeyPair();
  const keys2 = generateSigningSeedAndKeyPair();
  const message = new TextEncoder().encode("hello");

  const signature = sign(message, keys1.signingPrivateKey);
  expect(verify(signature, message, keys2.signingPublicKey)).toBe(false);
});

test("verify returns false with tampered message", () => {
  const { signingPublicKey, signingPrivateKey } =
    generateSigningSeedAndKeyPair();
  const message = new TextEncoder().encode("hello");
  const tampered = new TextEncoder().encode("world");

  const signature = sign(message, signingPrivateKey);
  expect(verify(signature, tampered, signingPublicKey)).toBe(false);
});
