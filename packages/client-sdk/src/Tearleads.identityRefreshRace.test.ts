import { expect, test } from "bun:test";
import {
  createIdentitySeedPhraseFromEntropy,
  generateIdentityKeyPairsFromSeedPhrase,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { quietLogger } from "../test/helpers/clientTestSupport";
import { createMemoryBlobStore, Tearleads } from ".";
import { createExecSql } from "./sqlite";

const seedPhrase = createIdentitySeedPhraseFromEntropy(
  new Uint8Array(32).fill(7),
);
const nextPhrase = createIdentitySeedPhraseFromEntropy(
  new Uint8Array(32).fill(8),
);

test("a fingerprint refresh neither cancels an import nor restores its previous keys", async () => {
  const sdk = new Tearleads({
    blobStoreFactory: () => createMemoryBlobStore(),
    logger: quietLogger,
  });
  try {
    await sdk.identity.importSeedPhrase(seedPhrase);
    const pending = sdk.identity.importSeedPhrase(nextPhrase);
    const refresh = sdk.identity.refreshSigningFingerprint();
    const [result] = await Promise.all([pending, refresh]);
    expect(result.seedPhrase).toBe(nextPhrase);
    expect(sdk.identity.snapshot).toBe(result);
    expect(sdk.identity.signingFingerprint).toBe(result.signingFingerprint);
  } finally {
    sdk.dispose();
  }
});

test("generation rejected before SQLite is ready does not cancel an import", async () => {
  const sdk = new Tearleads({
    blobStoreFactory: () => createMemoryBlobStore(),
    logger: quietLogger,
  });
  try {
    const pending = sdk.identity.importSeedPhrase(seedPhrase);
    await expect(sdk.identity.generate()).rejects.toThrow("ready SQLite");
    expect((await pending).seedPhrase).toBe(seedPhrase);
    expect(sdk.identity.seedPhrase).toBe(seedPhrase);
  } finally {
    sdk.dispose();
  }
});

test("refreshing constructor keys during root bootstrap does not cancel generation", async () => {
  const { close, execSql } = await createTestExecSql("identity-refresh-race");
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const sdk = new Tearleads({
    identity: generateIdentityKeyPairsFromSeedPhrase(seedPhrase),
    blobStoreFactory: () => createMemoryBlobStore(),
    database: {
      id: "identity-refresh-race",
      execSql: createExecSql({
        exec: async ({ sql, bind, rowMode }) => {
          entered.resolve();
          await resume.promise;
          return {
            rows: await execSql(sql, bind, { rowMode: rowMode ?? "object" }),
          };
        },
      }),
    },
    logger: quietLogger,
  });
  try {
    const pending = sdk.identity.generate();
    await entered.promise;
    const refreshed = await sdk.identity.refreshSigningFingerprint();
    expect(refreshed).not.toBeNull();
    resume.resolve();
    const result = await pending;
    expect(sdk.identity.snapshot.seedPhrase).toBe(result.seedPhrase);
    expect(sdk.identity.signingFingerprint).not.toBe(refreshed);
    expect(sdk.session.containerId).toBe(result.rootContainerId);
  } finally {
    resume.resolve();
    sdk.dispose();
    close();
  }
});
