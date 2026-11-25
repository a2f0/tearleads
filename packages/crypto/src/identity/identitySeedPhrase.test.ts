import { expect, test } from "bun:test";
import {
  createIdentitySeedPhrase,
  createIdentitySeedPhraseFromEntropy,
  generateIdentityKeyPairsFromSeedPhrase,
  IDENTITY_SEED_PHRASE_WORDS,
  normalizeIdentitySeedPhrase,
  validateIdentitySeedPhrase,
} from "./identitySeedPhrase";

test("creates a valid 24-word identity seed phrase", () => {
  const seedPhrase = createIdentitySeedPhrase();

  expect(seedPhrase.split(" ")).toHaveLength(IDENTITY_SEED_PHRASE_WORDS);
  expect(validateIdentitySeedPhrase(seedPhrase)).toBe(true);
});

test("same identity seed phrase derives the same keypairs", () => {
  const seedPhrase = createIdentitySeedPhraseFromEntropy(
    new Uint8Array(32).fill(0xab),
  );

  const first = generateIdentityKeyPairsFromSeedPhrase(seedPhrase);
  const second = generateIdentityKeyPairsFromSeedPhrase(seedPhrase);

  expect(first.seedPhrase).toBe(seedPhrase);
  expect(first.signingKeyPair.signingPublicKey).toEqual(
    second.signingKeyPair.signingPublicKey,
  );
  expect(first.signingKeyPair.signingPrivateKey).toEqual(
    second.signingKeyPair.signingPrivateKey,
  );
  expect(first.encapsulationKeyPair.publicKey).toEqual(
    second.encapsulationKeyPair.publicKey,
  );
  expect(first.encapsulationKeyPair.secretKey).toEqual(
    second.encapsulationKeyPair.secretKey,
  );
});

test("identity seed phrase normalization is whitespace and case tolerant", () => {
  const seedPhrase = createIdentitySeedPhraseFromEntropy(
    new Uint8Array(32).fill(0xcd),
  );
  const pasted = `  ${seedPhrase.toUpperCase().replaceAll(" ", "  \n")}  `;

  expect(normalizeIdentitySeedPhrase(pasted)).toBe(seedPhrase);
  expect(generateIdentityKeyPairsFromSeedPhrase(pasted).seedPhrase).toBe(
    seedPhrase,
  );
});

test("identity seed phrases require 256-bit entropy", () => {
  expect(() =>
    createIdentitySeedPhraseFromEntropy(new Uint8Array(16).fill(0xab)),
  ).toThrow("32 bytes");
  expect(() =>
    generateIdentityKeyPairsFromSeedPhrase(
      "legal winner thank year wave sausage worth useful legal winner thank yellow",
    ),
  ).toThrow("24 words");
});
