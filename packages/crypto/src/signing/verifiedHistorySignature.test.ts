import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "./generateKeyPair";
import { sign } from "./sign";
import { createHistorySignatureVerifier } from "./verifiedHistorySignature";
import { verify } from "./verify";

test("extending 64 verified entries to 128 verifies only the 64 new signatures", () => {
  const signer = generateSigningSeedAndKeyPair();
  const entries = Array.from({ length: 128 }, (_, index) => {
    const message = new TextEncoder().encode(`history entry ${index}`);
    return { message, signature: sign(message, signer.signingPrivateKey) };
  });
  let calls = 0;
  const check = createHistorySignatureVerifier((...args) => {
    calls++;
    return verify(...args);
  });
  const checkAll = (count: number) => {
    for (const entry of entries.slice(0, count))
      expect(
        check(entry.signature, entry.message, signer.signingPublicKey),
      ).toBe(true);
  };
  checkAll(64);
  expect(calls).toBe(64);
  checkAll(64);
  expect(calls).toBe(64);
  checkAll(128);
  expect(calls).toBe(128);
});

test("history signature reuse binds exact message, signature and trusted key; eviction re-verifies", () => {
  const signer = generateSigningSeedAndKeyPair();
  const other = generateSigningSeedAndKeyPair();
  const message = new TextEncoder().encode("signed authorization history");
  const signature = sign(message, signer.signingPrivateKey);
  let calls = 0;
  const check = createHistorySignatureVerifier((...args) => {
    calls++;
    return verify(...args);
  }, 1);
  expect(check(signature, message, signer.signingPublicKey)).toBe(true);
  expect(
    check(signature.slice(), message.slice(), signer.signingPublicKey.slice()),
  ).toBe(true);
  expect(calls).toBe(1);
  expect(check(signature, message, other.signingPublicKey)).toBe(false);
  expect(
    check(
      signature,
      new TextEncoder().encode("forged"),
      signer.signingPublicKey,
    ),
  ).toBe(false);
  const altered = signature.slice();
  altered[0] = (altered[0] ?? 0) ^ 1;
  expect(check(altered, message, signer.signingPublicKey)).toBe(false);
  const next = new TextEncoder().encode("next history entry");
  expect(
    check(sign(next, signer.signingPrivateKey), next, signer.signingPublicKey),
  ).toBe(true);
  expect(check(signature, message, signer.signingPublicKey)).toBe(true);
  expect(calls).toBe(6);
});
