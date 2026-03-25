import { expect, test } from "bun:test";
import { generateSeedAndKeyPair } from "./generateKeyPair";
import { sign } from "./sign";
import { verify } from "./verify";

test("sign and verify round-trip", () => {
  const { publicKey, secretKey } = generateSeedAndKeyPair();
  const message = new TextEncoder().encode("hello");

  const signature = sign(message, secretKey);
  expect(verify(signature, message, publicKey)).toBe(true);
});
