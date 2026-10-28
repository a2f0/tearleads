import { expect, test } from "bun:test";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { quietLogger } from "../test/helpers/clientTestSupport";
import { createMemoryBlobStore, Tearleads } from ".";
import {
  ensureContainerTables,
  loadContainers,
} from "./data/persistence/container-contents/containerPersistence";

test("a failed blob factory leaves identity, root, and subscriptions unchanged and can retry", async () => {
  const { close, execSql } = await createTestExecSql("identity-blob-failure");
  let fail = true;
  const sdk = new Tearleads({
    blobStoreFactory: () => {
      if (fail) throw new Error("blob backend unavailable");
      return createMemoryBlobStore();
    },
    database: { execSql, id: "identity-blob-failure" },
    logger: quietLogger,
  });
  try {
    await ensureContainerTables(execSql);
    const before = sdk.identity.snapshot;
    const store = sdk.blobs.store;
    let notifications = 0;
    sdk.identity.subscribe(() => {
      notifications += 1;
    });

    await expect(sdk.identity.generate()).rejects.toThrow(
      "blob backend unavailable",
    );

    expect(sdk.identity.snapshot === before).toBe(true);
    expect(sdk.identity.signingKeyPair).toBe(before.signingKeyPair);
    expect(sdk.identity.encapsulationKeyPair).toBe(before.encapsulationKeyPair);
    expect(sdk.identity.seedPhrase).toBe(before.seedPhrase);
    expect(sdk.identity.signingFingerprint).toBe(before.signingFingerprint);
    expect(sdk.session.containerId).toBeNull();
    expect(await loadContainers(execSql)).toEqual([]);
    expect(sdk.blobs.store).toBe(store);
    expect(notifications).toBe(0);

    fail = false;
    const result = await sdk.identity.generate();
    expect(result.rootContainerCreated).toBe(true);
    expect(sdk.session.containerId).toBe(result.rootContainerId);
    expect(sdk.blobs.store).not.toBe(store);
    expect(notifications).toBe(1);

    const generated = sdk.identity.snapshot;
    const generatedStore = sdk.blobs.store;
    fail = true;
    await expect(sdk.identity.generate()).rejects.toThrow(
      "blob backend unavailable",
    );
    expect(sdk.identity.snapshot === generated).toBe(true);
    expect(sdk.identity.signingKeyPair).toBe(generated.signingKeyPair);
    expect(sdk.session.containerId).toBe(result.rootContainerId);
    expect(sdk.blobs.store).toBe(generatedStore);
    expect(notifications).toBe(1);
  } finally {
    sdk.dispose();
    close();
  }
});

test.each(["seed", "keys", "package"] as const)(
  "a failed identity import via %s preserves the previous keys and blob store",
  async (method) => {
    let fail = false;
    const sdk = new Tearleads({
      blobStoreFactory: () => {
        if (fail) throw new Error("blob backend unavailable");
        return createMemoryBlobStore();
      },
      logger: quietLogger,
    });
    try {
      const nextPhrase = createIdentitySeedPhraseFromEntropy(
        new Uint8Array(32).fill(2),
      );
      const nextKeys = await sdk.identity.importSeedPhrase(nextPhrase);
      const nextPackage = await sdk.identity.exportKeyPackage();
      await sdk.identity.importSeedPhrase(
        createIdentitySeedPhraseFromEntropy(new Uint8Array(32).fill(1)),
      );
      const before = sdk.identity.snapshot;
      const store = sdk.blobs.store;
      let notifications = 0;
      sdk.identity.subscribe(() => {
        notifications += 1;
      });
      fail = true;

      const pending =
        method === "seed"
          ? sdk.identity.importSeedPhrase(nextPhrase)
          : method === "keys"
            ? sdk.identity.setKeyPairs({
                encapsulationKeyPair: nextKeys.encapsulationKeyPair,
                signingKeyPair: nextKeys.signingKeyPair,
              })
            : sdk.identity.importKeyPackage(nextPackage);
      await expect(pending).rejects.toThrow("blob backend unavailable");

      expect(sdk.identity.snapshot === before).toBe(true);
      expect(sdk.identity.signingKeyPair === before.signingKeyPair).toBe(true);
      expect(
        sdk.identity.encapsulationKeyPair === before.encapsulationKeyPair,
      ).toBe(true);
      expect(sdk.blobs.store).toBe(store);
      expect(notifications).toBe(0);
    } finally {
      sdk.dispose();
    }
  },
);

test("a failed explicit namespace switch preserves a fixed blob backend", async () => {
  const store = createMemoryBlobStore();
  const sdk = new Tearleads({
    blobStore: store,
    blobStoreFactory: () => {
      throw new Error("blob backend unavailable");
    },
    logger: quietLogger,
  });
  try {
    expect(() => sdk.blobs.useIdentityNamespace("unavailable")).toThrow(
      "blob backend unavailable",
    );
    await sdk.identity.importSeedPhrase(
      createIdentitySeedPhraseFromEntropy(new Uint8Array(32).fill(3)),
    );
    expect(sdk.identity.signingFingerprint).not.toBeNull();
    expect(sdk.blobs.store).toBe(store);
  } finally {
    sdk.dispose();
  }
});

test("an in-flight fingerprint refresh cannot restore a destroyed identity", async () => {
  const sdk = new Tearleads({
    blobStoreFactory: () => createMemoryBlobStore(),
    logger: quietLogger,
  });
  try {
    await sdk.identity.importSeedPhrase(
      createIdentitySeedPhraseFromEntropy(new Uint8Array(32).fill(4)),
    );
    const refresh = sdk.identity.refreshSigningFingerprint();
    sdk.identity.destroy();
    await expect(refresh).resolves.toBeNull();
    expect(sdk.identity.signingKeyPair).toBeNull();
    expect(sdk.identity.signingFingerprint).toBeNull();
  } finally {
    sdk.dispose();
  }
});

test("a root bootstrap failure does not activate the prepared identity blob store", async () => {
  let factoryCalls = 0;
  const messages: string[] = [];
  const sdk = new Tearleads({
    blobStoreFactory: () => {
      factoryCalls += 1;
      return createMemoryBlobStore();
    },
    database: {
      execSql: async () => {
        throw new Error("locked database");
      },
      id: "identity-root-failure",
    },
    logger: { ...quietLogger, log: (message) => messages.push(message) },
  });
  try {
    const before = sdk.identity.snapshot;
    const store = sdk.blobs.store;
    await expect(sdk.identity.generate()).rejects.toThrow("locked database");
    expect(factoryCalls).toBe(1);
    expect(messages.join()).toContain("locked database");
    expect(sdk.identity.snapshot === before).toBe(true);
    expect(sdk.identity.signingKeyPair).toBeNull();
    expect(sdk.session.containerId).toBeNull();
    expect(sdk.blobs.store).toBe(store);
  } finally {
    sdk.dispose();
  }
});
