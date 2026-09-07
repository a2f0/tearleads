import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  createIdentitySeedPhraseFromEntropy,
  generateIdentityKeyPairsFromSeedPhrase,
} from "./identitySeedPhrase";

// Captured from main at 78bdab7c using @noble/post-quantum 0.5.4,
// @noble/hashes 2.0.1, and @scure/bip39 2.2.0. These public test phrases
// must recover the same complete public/private keys after dependency upgrades.
const vectors = [
  {
    entropy: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    seedPhrase:
      "abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware",
    signingPublic:
      "750ae08cbf800f66831ebfbeb6d6115d0896fa139e9433d9d5eff8fed4ad0bd1",
    signingPrivate:
      "34a7a34018d19c9638a078f1693d14a52c5cf223c53465b42904ccdc1d8b2376",
    encapsulationPublic:
      "35919398ea83cbe533056b055ec3e820ad9c2a1717ee2796c51f1294b5720da6",
    encapsulationPrivate:
      "4a8e15aed82e92c7fed78782ae78152996599da650563633f55f5335cf0825a9",
  },
  {
    entropy: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    seedPhrase:
      "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote",
    signingPublic:
      "5c265c2c8aaee3309e7f46e9bcc571f0b1ccac28143c6126dda550189c197519",
    signingPrivate:
      "395ffe51aa0afd0a4861a7f7015a3f552207a76dc583e6025adb2bb6962f8c34",
    encapsulationPublic:
      "8aaf4a137f640e4a6f3b1a00053ea39f42e497600909361ab8477ba910ab57d7",
    encapsulationPrivate:
      "308bec3fc6ec4584f80c4cd9fa7029f17d5d0502148ec8f4e1bfb58d1d4f74a8",
  },
];

function fingerprint(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

test.each(vectors)(
  "preserves pre-upgrade identity recovery for $entropy",
  (vector) => {
    const entropy = Uint8Array.from(Buffer.from(vector.entropy, "hex"));
    expect(createIdentitySeedPhraseFromEntropy(entropy)).toBe(
      vector.seedPhrase,
    );
    const { signingKeyPair, encapsulationKeyPair } =
      generateIdentityKeyPairsFromSeedPhrase(vector.seedPhrase);
    expect(fingerprint(signingKeyPair.signingPublicKey)).toBe(
      vector.signingPublic,
    );
    expect(fingerprint(signingKeyPair.signingPrivateKey)).toBe(
      vector.signingPrivate,
    );
    expect(fingerprint(encapsulationKeyPair.publicKey)).toBe(
      vector.encapsulationPublic,
    );
    expect(fingerprint(encapsulationKeyPair.secretKey)).toBe(
      vector.encapsulationPrivate,
    );
  },
);
