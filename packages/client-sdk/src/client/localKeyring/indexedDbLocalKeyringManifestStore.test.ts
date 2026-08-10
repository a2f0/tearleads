import { expect, test } from "bun:test";
import { createFakeIndexedDb } from "../../../test/helpers/localKeyringFakes";
import {
  createIndexedDbLocalKeyringManifestStore,
  createLocalKeyring,
  createMemoryWrappingKeyKeystore,
  type LocalKeyringScope,
} from "./index";

const scope: LocalKeyringScope = {
  accountId: "user-1",
  namespace: "tearleads.sqlite",
  signingFingerprint: "fp-1",
};

test("loading or deleting a missing manifest is a no-op", async () => {
  const store = createIndexedDbLocalKeyringManifestStore({
    indexedDB: createFakeIndexedDb(),
  });

  expect(await store.loadManifest(scope)).toBeNull();
  await store.deleteManifest(scope); // must not throw
  expect(await store.loadManifest(scope)).toBeNull();
});

test("a keyring persists and re-derives its key through the IndexedDB manifest store", async () => {
  const indexedDB = createFakeIndexedDb();
  // Shared keystore so the wrapping key survives across the two keyring instances.
  const keystore = createMemoryWrappingKeyKeystore();

  const first = createLocalKeyring({
    keystore,
    manifestStore: createIndexedDbLocalKeyringManifestStore({ indexedDB }),
  });
  const created = await first.getOrCreateSession(scope);
  const originalKey = created.sqliteKey;
  created.dispose();

  // A fresh keyring + fresh store over the SAME IndexedDB must reload the manifest
  // and derive the identical sqliteKey — the cross-session stability a persisted,
  // encrypted database depends on.
  const second = createLocalKeyring({
    keystore,
    manifestStore: createIndexedDbLocalKeyringManifestStore({ indexedDB }),
  });
  const reloaded = await second.loadSession(scope);
  expect(reloaded).not.toBeNull();
  expect(reloaded?.sqliteKey).toBe(originalKey);
  reloaded?.dispose();

  // Deleting the session removes the manifest.
  await second.deleteSession(scope);
  const third = createLocalKeyring({
    keystore,
    manifestStore: createIndexedDbLocalKeyringManifestStore({ indexedDB }),
  });
  expect(await third.loadSession(scope)).toBeNull();
});
