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
  new Uint8Array(32).fill(5),
);

test.each(["seed", "keys", "package"] as const)(
  "destroy supersedes an in-flight identity import via %s",
  async (method) => {
    const sdk = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    try {
      await sdk.identity.importSeedPhrase(seedPhrase);
      const keyPackage = await sdk.identity.exportKeyPackage();
      const pending =
        method === "seed"
          ? sdk.identity.importSeedPhrase(seedPhrase)
          : method === "keys"
            ? sdk.identity.setKeyPairs(
                generateIdentityKeyPairsFromSeedPhrase(seedPhrase),
              )
            : sdk.identity.importKeyPackage(keyPackage);
      sdk.identity.destroy();
      await expect(pending).rejects.toThrow("superseded");
      expect(sdk.identity.signingKeyPair).toBeNull();
      expect(sdk.identity.encapsulationKeyPair).toBeNull();
      expect(sdk.identity.signingFingerprint).toBeNull();
    } finally {
      sdk.dispose();
    }
  },
);

test("the latest-started identity change wins when imports overlap", async () => {
  const sdk = new Tearleads({
    blobStoreFactory: () => createMemoryBlobStore(),
    logger: quietLogger,
  });
  try {
    const nextPhrase = createIdentitySeedPhraseFromEntropy(
      new Uint8Array(32).fill(6),
    );
    const first = sdk.identity.importSeedPhrase(seedPhrase);
    const second = sdk.identity.importSeedPhrase(nextPhrase);
    await expect(first).rejects.toThrow("superseded");
    const result = await second;
    expect(result.seedPhrase).toBe(nextPhrase);
    expect(sdk.identity.seedPhrase).toBe(nextPhrase);
  } finally {
    sdk.dispose();
  }
});

test.each(["destroy", "blob-namespace"] as const)(
  "%s supersedes generation while the root bootstrap is pending",
  async (change) => {
    const { close, execSql } = await createTestExecSql(
      `identity-race-${change}`,
    );
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const delayedExecSql = createExecSql({
      exec: async ({ sql, bind, rowMode }) => {
        entered.resolve();
        await resume.promise;
        return {
          rows: await execSql(sql, bind, { rowMode: rowMode ?? "object" }),
        };
      },
    });
    const fixedStore = createMemoryBlobStore();
    const sdk = new Tearleads({
      ...(change === "blob-namespace" ? { blobStore: fixedStore } : {}),
      blobStoreFactory: () => createMemoryBlobStore(),
      database: { execSql: delayedExecSql, id: `identity-race-${change}` },
      logger: quietLogger,
    });
    try {
      const pending = sdk.identity.generate();
      await entered.promise;
      if (change === "destroy") sdk.identity.destroy();
      else sdk.blobs.useIdentityNamespace("explicit-host-namespace");
      const store = sdk.blobs.store;
      resume.resolve();
      await expect(pending).rejects.toThrow("superseded");
      expect(sdk.identity.signingKeyPair).toBeNull();
      expect(sdk.session.containerId).toBeNull();
      expect(sdk.blobs.store).toBe(store);
    } finally {
      resume.resolve();
      sdk.dispose();
      close();
    }
  },
);
