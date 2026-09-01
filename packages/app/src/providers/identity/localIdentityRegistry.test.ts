import { expect, test } from "bun:test";
import {
  IDENTITY_KEY_PACKAGE_FORMAT,
  type IdentityKeyPackage,
} from "@tearleads/client-sdk";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import {
  LocalIdentityRepository,
  type LocalIdentityStorage,
} from "./localIdentityRegistry";

function createKeyPackage(
  signingFingerprint: string,
  createdAt: string,
): IdentityKeyPackage {
  return {
    createdAt,
    encapsulationKeyPair: { publicKey: "public", secretKey: "secret" },
    format: IDENTITY_KEY_PACKAGE_FORMAT,
    signingFingerprint,
    signingKeyPair: {
      signingPrivateKey: "private",
      signingPublicKey: "public",
    },
    version: 1,
  };
}

function createMemoryStorage(): LocalIdentityStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
    values,
  };
}

test("local identity registry retains multiple identities and active selection", async () => {
  const storage = createMemoryStorage();
  const repository = new LocalIdentityRepository({
    keyring: createSharedMemoryLocalKeyringFactory()(),
    scope: localIdentityScope("registry-test"),
    storage,
    storageKey: "identities",
  });
  const identityA = createKeyPackage(
    "a".repeat(64),
    "2026-01-01T00:00:00.000Z",
  );
  const identityB = createKeyPackage(
    "b".repeat(64),
    "2026-01-02T00:00:00.000Z",
  );

  await repository.upsert(identityA);
  await repository.upsert(identityB);
  await repository.setActive(identityA.signingFingerprint);

  const loaded = await repository.load();
  expect(loaded.activeSigningFingerprint).toBe(identityA.signingFingerprint);
  expect(loaded.activeKeyPackage).toEqual(identityA);
  expect(loaded.identities).toEqual([
    {
      addedAt: identityA.createdAt,
      signingFingerprint: identityA.signingFingerprint,
    },
    {
      addedAt: identityB.createdAt,
      signingFingerprint: identityB.signingFingerprint,
    },
  ]);
  expect(storage.values.get("identities")).not.toContain(
    identityA.signingFingerprint,
  );
});

test("removing one identity leaves the shared registry key usable by another", async () => {
  const storage = createMemoryStorage();
  const keyring = createSharedMemoryLocalKeyringFactory()();
  const scope = localIdentityScope("registry-remove-test");
  const repository = new LocalIdentityRepository({
    keyring,
    scope,
    storage,
    storageKey: "identities",
  });
  const identityA = createKeyPackage(
    "a".repeat(64),
    "2026-01-01T00:00:00.000Z",
  );
  const identityB = createKeyPackage(
    "b".repeat(64),
    "2026-01-02T00:00:00.000Z",
  );

  await repository.upsert(identityA);
  await repository.upsert(identityB);
  await repository.remove(identityA.signingFingerprint);

  expect(await repository.findKeyPackage(identityB.signingFingerprint)).toEqual(
    identityB,
  );
  expect(await keyring.loadSession(scope)).not.toBeNull();

  await repository.remove(identityB.signingFingerprint);
  expect(storage.values.has("identities")).toBe(false);
  expect(await keyring.loadSession(scope)).toBeNull();
});

test("removing the active identity selects the first remaining identity", async () => {
  const repository = new LocalIdentityRepository({
    keyring: createSharedMemoryLocalKeyringFactory()(),
    scope: localIdentityScope("registry-active-fallback-test"),
    storage: createMemoryStorage(),
    storageKey: "identities",
  });
  const identityA = createKeyPackage(
    "a".repeat(64),
    "2026-01-01T00:00:00.000Z",
  );
  const identityB = createKeyPackage(
    "b".repeat(64),
    "2026-01-02T00:00:00.000Z",
  );
  const identityC = createKeyPackage(
    "c".repeat(64),
    "2026-01-03T00:00:00.000Z",
  );

  await repository.upsert(identityA);
  await repository.upsert(identityB);
  await repository.upsert(identityC);
  await repository.remove(identityC.signingFingerprint);

  const loaded = await repository.load();
  expect(loaded.activeSigningFingerprint).toBe(identityA.signingFingerprint);
  expect(loaded.activeKeyPackage).toEqual(identityA);
  expect(
    loaded.identities.map((identity) => identity.signingFingerprint),
  ).toEqual([identityA.signingFingerprint, identityB.signingFingerprint]);
});
