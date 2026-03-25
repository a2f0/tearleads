import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "./generateKeyPair";
import { sign } from "./sign";
import { verify } from "./verify";

test("sign and verify round-trip", () => {
  const { signingPublicKey, signingPrivateKey } =
    generateSigningSeedAndKeyPair();
  const message = new TextEncoder().encode("hello");

  const signature = sign(message, signingPrivateKey);
  expect(verify(signature, message, signingPublicKey)).toBe(true);
});
