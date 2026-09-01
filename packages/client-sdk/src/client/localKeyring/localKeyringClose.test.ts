import { expect, test } from "bun:test";
import { createFakeIndexedDb } from "../../../test/helpers/localKeyringFakes";
import {
  createBrowserLocalKeyring,
  createLocalKeyring,
  createMemoryLocalKeyringManifestStore,
  createMemoryWrappingKeyKeystore,
  type LocalKeyringManifestStore,
} from "./index";

test("closing a browser keyring releases both IndexedDB connections", async () => {
  const closedDatabaseNames: string[] = [];
  const keyring = createBrowserLocalKeyring({
    indexedDB: createFakeIndexedDb({
      onClose: (name) => closedDatabaseNames.push(name),
    }),
  });
  await keyring.getOrCreateSession({ namespace: "test" });

  keyring.close?.();
  keyring.close?.();
  await Promise.resolve();

  expect(closedDatabaseNames.sort()).toEqual([
    "tearleads-local-keyring",
    "tearleads-local-keyring-manifests",
  ]);
  await expect(
    keyring.getOrCreateSession({ namespace: "test" }),
  ).rejects.toThrow("closed");
});

test("closing a keyring does not dispose a session owned by its caller", async () => {
  const keyring = createLocalKeyring({
    keystore: createMemoryWrappingKeyKeystore(),
    manifestStore: createMemoryLocalKeyringManifestStore(),
  });
  const session = await keyring.getOrCreateSession({ namespace: "test" });
  const capturedBlobStoreKey = session.blobStoreKey;
  const expectedBlobStoreKey = capturedBlobStoreKey.slice();
  const expectedDerivedKey = await session.deriveKey("captured-key-test");

  keyring.close?.();
  await Promise.resolve();

  expect(capturedBlobStoreKey).toEqual(expectedBlobStoreKey);
  await expect(session.deriveKey("captured-key-test")).resolves.toEqual(
    expectedDerivedKey,
  );

  session.dispose();
  expect(capturedBlobStoreKey).toEqual(
    new Uint8Array(capturedBlobStoreKey.byteLength),
  );
});

test("closing a keyring does not dispose a session from an in-flight operation", async () => {
  let markLoadStarted: (() => void) | undefined;
  const loadStarted = new Promise<void>((resolve) => {
    markLoadStarted = resolve;
  });
  let releaseLoad: (() => void) | undefined;
  const loadReleased = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  const manifestStore: LocalKeyringManifestStore = {
    async deleteManifest() {},
    async loadManifest() {
      markLoadStarted?.();
      await loadReleased;
      return null;
    },
    async saveManifest() {},
  };
  const keyring = createLocalKeyring({
    keystore: createMemoryWrappingKeyKeystore(),
    manifestStore,
  });

  const sessionOperation = keyring.getOrCreateSession({ namespace: "test" });
  await loadStarted;
  keyring.close?.();
  releaseLoad?.();

  const session = await sessionOperation;
  const capturedKey = session.blobStoreKey;
  expect(capturedKey.some((byte) => byte !== 0)).toBe(true);
  await expect(session.deriveKey("in-flight-test")).resolves.toHaveLength(32);
  await expect(
    keyring.getOrCreateSession({ namespace: "test" }),
  ).rejects.toThrow("closed");

  session.dispose();
  expect(capturedKey).toEqual(new Uint8Array(capturedKey.byteLength));
});
