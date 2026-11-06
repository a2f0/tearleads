import { describe, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  quietLogger,
  setGeneratedIdentity,
} from "../test/helpers/clientTestSupport";
import { Tearleads } from ".";
import { createMemoryBlobStore } from "./data/blobs/memoryBlobStore";
import { loadContainers } from "./data/persistence/container-contents/containerPersistence";

const EMPTY_IDENTITY_SNAPSHOT = {
  encapsulationKeyPair: null,
  seedPhrase: null,
  signingFingerprint: null,
  signingKeyPair: null,
} as const;

describe("Tearleads", () => {
  test("rejects identity generation until SQLite is ready", async () => {
    const sdk = new Tearleads({ logger: quietLogger });
    const ephemeralStore = sdk.blobs.store;

    await expect(sdk.identity.generate()).rejects.toThrow("ready SQLite");

    expect(sdk.identity.snapshot).toEqual(EMPTY_IDENTITY_SNAPSHOT);
    expect(sdk.session.containerId).toBeNull();
    expect(sdk.blobs.store).toBe(ephemeralStore);
  });

  test("generates identity keys, bootstraps the local root container, and switches blob storage when SQLite is ready", async () => {
    const { close, execSql } = await createTestExecSql(
      "tearleads-identity-generate-root-bootstrap-test",
    );
    try {
      const sdk = new Tearleads({
        blobStoreFactory: () => createMemoryBlobStore(),
        database: { execSql, id: "client-db" },
        logger: quietLogger,
      });
      const ephemeralStore = sdk.blobs.store;

      const result = await sdk.identity.generate();

      expect(result.rootContainerCreated).toBe(true);
      expect(result.rootContainerId).toHaveLength(36);
      expect(result.userId).toBeNull();
      expect(sdk.session.containerId).toBe(result.rootContainerId);
      expect(result.signingKeyPair).not.toBeNull();
      expect(result.encapsulationKeyPair).not.toBeNull();
      expect(result.signingFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(sdk.identity.signingFingerprint).toBe(result.signingFingerprint);
      expect(sdk.blobs.store).not.toBe(ephemeralStore);

      await expect(sdk.session.bootstrapLocalRootContainer()).resolves.toEqual({
        containerId: result.rootContainerId,
        created: false,
      });

      const containers = await loadContainers(execSql);
      expect(containers).toEqual([
        expect.objectContaining({
          id: result.rootContainerId,
          name: "/",
          parentId: null,
        }),
      ]);

      sdk.identity.destroy();

      expect(sdk.identity.signingFingerprint).toBeNull();
      expect(sdk.blobs.store).toBe(ephemeralStore);
    } finally {
      close();
    }
  });

  test("uses a blob store factory for identity namespaces", async () => {
    const namespaces: string[] = [];
    const stores = [createMemoryBlobStore()];
    const sdk = new Tearleads({
      blobStoreFactory: (namespace) => {
        namespaces.push(namespace);
        const store = stores[namespaces.length - 1];
        if (!store) {
          throw new Error("Unexpected blob store factory call.");
        }

        return store;
      },
      logger: quietLogger,
    });
    const ephemeralStore = sdk.blobs.store;

    const snapshot = await setGeneratedIdentity(sdk.identity);
    if (!snapshot.signingFingerprint) {
      throw new Error("Expected generated signing fingerprint.");
    }
    const identityStore = stores[0];
    if (!identityStore) {
      throw new Error("Expected identity blob store.");
    }

    expect(namespaces).toEqual([snapshot.signingFingerprint]);
    expect(sdk.blobs.store).toBe(identityStore);
    expect(sdk.blobs.store).not.toBe(ephemeralStore);

    sdk.identity.destroy();

    expect(sdk.blobs.store).toBe(ephemeralStore);
  });

  test("notifies identity subscribers with stable snapshots", async () => {
    const sdk = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    const snapshots: Array<{
      hasEncapsulationKeyPair: boolean;
      hasSigningKeyPair: boolean;
      signingFingerprint: string | null;
    }> = [];
    const unsubscribe = sdk.identity.subscribe(() => {
      snapshots.push({
        hasEncapsulationKeyPair:
          sdk.identity.snapshot.encapsulationKeyPair !== null,
        hasSigningKeyPair: sdk.identity.snapshot.signingKeyPair !== null,
        signingFingerprint: sdk.identity.snapshot.signingFingerprint,
      });
    });

    await setGeneratedIdentity(sdk.identity);
    sdk.identity.destroy();
    unsubscribe();
    sdk.identity.destroy();

    expect(snapshots).toEqual([
      {
        hasEncapsulationKeyPair: true,
        hasSigningKeyPair: true,
        signingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      {
        hasEncapsulationKeyPair: false,
        hasSigningKeyPair: false,
        signingFingerprint: null,
      },
    ]);
  });

  test("exports and imports identity key packages", async () => {
    const source = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    await setGeneratedIdentity(source.identity);

    const keyPackage = await source.identity.exportKeyPackage();
    source.identity.destroy();
    await source.identity.importKeyPackage(
      JSON.parse(JSON.stringify(keyPackage)),
    );

    expect(source.identity.signingFingerprint).toBe(
      keyPackage.signingFingerprint,
    );
    expect(
      Array.from(source.identity.signingKeyPair?.signingPublicKey ?? []),
    ).toEqual(
      Array.from(base64ToBytes(keyPackage.signingKeyPair.signingPublicKey)),
    );
  });

  test("rejects identity key packages with mismatched signing fingerprints", async () => {
    const sdk = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    await setGeneratedIdentity(sdk.identity);
    const keyPackage = await sdk.identity.exportKeyPackage();

    await expect(
      sdk.identity.importKeyPackage({
        ...keyPackage,
        signingFingerprint: "0".repeat(64),
      }),
    ).rejects.toThrow("signing fingerprint does not match");
  });

  test("rejects identity key packages with mismatched signing key pairs", async () => {
    const sdk = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    await setGeneratedIdentity(sdk.identity);
    const keyPackage = await sdk.identity.exportKeyPackage();
    const otherSigningKeyPair = generateSigningSeedAndKeyPair();

    await expect(
      sdk.identity.importKeyPackage({
        ...keyPackage,
        signingKeyPair: {
          ...keyPackage.signingKeyPair,
          signingPrivateKey: bytesToBase64(
            otherSigningKeyPair.signingPrivateKey,
          ),
        },
      }),
    ).rejects.toThrow("signing private key does not match");
  });

  test("rejects identity key packages with mismatched encapsulation key pairs", async () => {
    const sdk = new Tearleads({
      blobStoreFactory: () => createMemoryBlobStore(),
      logger: quietLogger,
    });
    await setGeneratedIdentity(sdk.identity);
    const keyPackage = await sdk.identity.exportKeyPackage();
    const otherEncapsulationKeyPair = generateKemSeedAndKeyPair();

    await expect(
      sdk.identity.importKeyPackage({
        ...keyPackage,
        encapsulationKeyPair: {
          ...keyPackage.encapsulationKeyPair,
          secretKey: bytesToBase64(otherEncapsulationKeyPair.secretKey),
        },
      }),
    ).rejects.toThrow("encapsulation secret key does not match");
  });
});
