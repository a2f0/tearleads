import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "./generateKeyPair";
import { sign } from "./sign";
import { createHistorySignatureVerifier } from "./verifiedHistorySignature";
import { createSignatureHistoryVerifier } from "./verifiedSignatureHistory";
import { verify } from "./verify";

function fixture(count: number) {
  const signer = generateSigningSeedAndKeyPair();
  return Array.from({ length: count }, (_, index) => {
    const message = new TextEncoder().encode(
      `signature transcript entry ${index}`,
    );
    return {
      message,
      signature: sign(message, signer.signingPrivateKey),
      publicKey: signer.signingPublicKey,
    };
  });
}

type Entry = ReturnType<typeof fixture>[number];
function stream(entries: readonly Entry[]) {
  return async function* () {
    yield* entries;
  };
}

test("a history larger than the individual signature cache reuses its exact prefix", async () => {
  const entries = fixture(6);
  let calls = 0;
  const individual = createHistorySignatureVerifier((...args) => {
    calls += 1;
    return verify(...args);
  }, 2);
  const check = createSignatureHistoryVerifier(individual);
  expect(await check(stream(entries.slice(0, 4)))).toBe(true);
  expect(calls).toBe(4);
  expect(await check(stream(entries.slice(0, 4)))).toBe(true);
  expect(calls).toBe(4);
  expect(await check(stream(entries))).toBe(true);
  expect(calls).toBe(6);
  check.clear();
  individual.clear();
  expect(await check(stream(entries))).toBe(true);
  expect(calls).toBe(12);
});

test("a cached history binds every message, signature and resolved key", async () => {
  const entries = fixture(4);
  const check = createSignatureHistoryVerifier();
  expect(await check(stream(entries))).toBe(true);
  const first = entries[0];
  if (!first) throw new Error("Missing signature");
  const signature = first.signature.slice();
  signature[0] = (signature[0] ?? 0) ^ 1;
  for (const altered of [
    { ...first, signature },
    { ...first, message: new TextEncoder().encode("forged message") },
    { ...first, publicKey: generateSigningSeedAndKeyPair().signingPublicKey },
  ]) {
    expect(await check(stream([altered, ...entries.slice(1)]))).toBe(false);
    expect(await check(stream([altered, ...entries.slice(1)]))).toBe(false);
  }
  expect(await check(stream(entries))).toBe(true);
});

test("history cache eviction and different ordering repeat signature mathematics", async () => {
  const entries = fixture(4);
  let calls = 0;
  const check = createSignatureHistoryVerifier((...args) => {
    calls += 1;
    return verify(...args);
  }, 1);
  expect(await check(stream(entries))).toBe(true);
  expect(await check(stream([...entries].reverse()))).toBe(true);
  expect(calls).toBe(8);
  expect(await check(stream(entries))).toBe(true);
  expect(calls).toBe(12);
});

test("a source cannot change or truncate inputs between transcript passes", async () => {
  const entries = fixture(4);
  const check = createSignatureHistoryVerifier();
  expect(await check(stream(entries))).toBe(true);
  const first = entries[0];
  if (!first) throw new Error("Missing signature");
  const signature = first.signature.slice();
  signature[0] = (signature[0] ?? 0) ^ 1;
  for (const changed of [
    [{ ...first, signature }, ...entries.slice(1)],
    entries.slice(1),
    [...entries].reverse(),
    [...entries, ...entries],
  ]) {
    let pass = 0;
    expect(
      await check(async function* () {
        pass += 1;
        yield* pass === 1 ? entries : changed;
      }),
    ).toBe(false);
  }
});
