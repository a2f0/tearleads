import { expect, test } from "bun:test";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import { createIdentity } from "./identity";

function createTestIdentity() {
  return createIdentity(
    {},
    () => undefined,
    () => undefined,
    {
      bootstrapLocalRootContainer: async () => ({
        containerId: "root-container-id",
        created: true,
      }),
      getUserId: () => null,
    },
  );
}

test("identity generation creates a seed-backed key package", async () => {
  const identity = createTestIdentity();

  const result = await identity.generate();
  const keyPackage = await identity.exportKeyPackage();

  if (!result.seedPhrase) {
    throw new Error("Expected generated identity to include a seed phrase.");
  }

  expect(result.seedPhrase.split(" ")).toHaveLength(24);
  expect(identity.seedPhrase).toBe(result.seedPhrase);
  expect(keyPackage.seedPhrase).toBe(result.seedPhrase);
});

test("identity seed phrases restore deterministic key pairs", async () => {
  const seedPhrase = createIdentitySeedPhraseFromEntropy(
    new Uint8Array(32).fill(0xab),
  );
  const source = createTestIdentity();
  await source.importSeedPhrase(seedPhrase);
  const signingFingerprint = source.signingFingerprint;

  const keyPackage = await source.exportKeyPackage();
  source.destroy();
  await source.importKeyPackage(JSON.parse(JSON.stringify(keyPackage)));

  expect(keyPackage.seedPhrase).toBe(seedPhrase);
  expect(source.seedPhrase).toBe(seedPhrase);
  expect(source.signingFingerprint).toBe(signingFingerprint);

  const restored = createTestIdentity();
  await restored.importSeedPhrase(seedPhrase.toUpperCase());
  expect(restored.seedPhrase).toBe(seedPhrase);
  expect(restored.signingFingerprint).toBe(signingFingerprint);
});

test("identity key packages reject mismatched seed phrases", async () => {
  const identity = createTestIdentity();
  await identity.importSeedPhrase(
    createIdentitySeedPhraseFromEntropy(new Uint8Array(32).fill(0xab)),
  );
  const keyPackage = await identity.exportKeyPackage();

  await expect(
    identity.importKeyPackage({
      ...keyPackage,
      seedPhrase: createIdentitySeedPhraseFromEntropy(
        new Uint8Array(32).fill(0xcd),
      ),
    }),
  ).rejects.toThrow("seed phrase does not match");
});
