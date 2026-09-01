import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  entropyToMnemonic,
  generateMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  type EncapsulationKeyPair,
  generateKemKeyPair,
  ML_KEM1024_SEED_BYTES,
} from "./encapsulation/generateKeyPair";
import {
  generateSigningKeyPair,
  type SigningKeyPair,
} from "./signing/generateKeyPair";

export const IDENTITY_SEED_PHRASE_DERIVATION_SUITE =
  "bip39-english-256-hkdf-sha256-ml-dsa87-ml-kem1024-v1";
export const IDENTITY_SEED_PHRASE_ENTROPY_BYTES = 32;
export const IDENTITY_SEED_PHRASE_STRENGTH_BITS = 256;
export const IDENTITY_SEED_PHRASE_WORDS = 24;

const TEXT_ENCODER = new TextEncoder();
const HKDF_SALT = TEXT_ENCODER.encode(
  "tearleads.identity-seed-phrase.hkdf-salt.v1",
);
const SIGNING_SEED_INFO = TEXT_ENCODER.encode(
  "tearleads.identity-seed-phrase.ml-dsa87-signing-seed.v1",
);
const ENCAPSULATION_SEED_INFO = TEXT_ENCODER.encode(
  "tearleads.identity-seed-phrase.ml-kem1024-encapsulation-seed.v1",
);
const ML_DSA87_SEED_BYTES = 32;

export interface IdentitySeedPhraseKeyPairs {
  readonly encapsulationKeyPair: EncapsulationKeyPair;
  readonly seedPhrase: string;
  readonly signingKeyPair: SigningKeyPair;
}

function seedPhraseWords(seedPhrase: string): readonly string[] {
  return seedPhrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function normalizeIdentitySeedPhrase(seedPhrase: string): string {
  return seedPhraseWords(seedPhrase).join(" ");
}

export function validateIdentitySeedPhrase(seedPhrase: string): boolean {
  const normalized = normalizeIdentitySeedPhrase(seedPhrase);
  return (
    seedPhraseWords(normalized).length === IDENTITY_SEED_PHRASE_WORDS &&
    validateMnemonic(normalized, wordlist)
  );
}

function readIdentitySeedPhraseEntropy(seedPhrase: string): {
  readonly entropy: Uint8Array;
  readonly normalizedSeedPhrase: string;
} {
  const normalizedSeedPhrase = normalizeIdentitySeedPhrase(seedPhrase);
  if (
    seedPhraseWords(normalizedSeedPhrase).length !== IDENTITY_SEED_PHRASE_WORDS
  ) {
    throw new Error(
      `Identity seed phrase must contain ${IDENTITY_SEED_PHRASE_WORDS} words.`,
    );
  }
  if (!validateMnemonic(normalizedSeedPhrase, wordlist)) {
    throw new Error("Identity seed phrase is not a valid BIP39 phrase.");
  }

  const entropy = mnemonicToEntropy(normalizedSeedPhrase, wordlist);
  if (entropy.length !== IDENTITY_SEED_PHRASE_ENTROPY_BYTES) {
    throw new Error(
      `Identity seed phrase must encode ${IDENTITY_SEED_PHRASE_ENTROPY_BYTES} bytes of entropy.`,
    );
  }

  return { entropy, normalizedSeedPhrase };
}

export function createIdentitySeedPhrase(): string {
  return generateMnemonic(wordlist, IDENTITY_SEED_PHRASE_STRENGTH_BITS);
}

export function createIdentitySeedPhraseFromEntropy(
  entropy: Uint8Array,
): string {
  if (entropy.length !== IDENTITY_SEED_PHRASE_ENTROPY_BYTES) {
    throw new Error(
      `Identity seed phrase entropy must be ${IDENTITY_SEED_PHRASE_ENTROPY_BYTES} bytes.`,
    );
  }

  return entropyToMnemonic(entropy, wordlist);
}

function deriveSeedMaterial(input: {
  readonly entropy: Uint8Array;
  readonly info: Uint8Array;
  readonly length: number;
}): Uint8Array {
  return hkdf(sha256, input.entropy, HKDF_SALT, input.info, input.length);
}

export function generateIdentityKeyPairsFromSeedPhrase(
  seedPhrase: string,
): IdentitySeedPhraseKeyPairs {
  const { entropy, normalizedSeedPhrase } =
    readIdentitySeedPhraseEntropy(seedPhrase);
  const signingSeed = deriveSeedMaterial({
    entropy,
    info: SIGNING_SEED_INFO,
    length: ML_DSA87_SEED_BYTES,
  });
  const encapsulationSeed = deriveSeedMaterial({
    entropy,
    info: ENCAPSULATION_SEED_INFO,
    length: ML_KEM1024_SEED_BYTES,
  });

  return {
    encapsulationKeyPair: generateKemKeyPair(encapsulationSeed),
    seedPhrase: normalizedSeedPhrase,
    signingKeyPair: generateSigningKeyPair(signingSeed),
  };
}
