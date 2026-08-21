import { expect, test } from "bun:test";
import {
  createFakeIndexedDb,
  createTestManifestStorage,
} from "../../../test/helpers/localKeyringFakes";
import {
  createBrowserLocalKeyringManifestStore,
  createLocalStorageLocalKeyringManifestStore,
  type LocalKeyringScope,
} from "./index";
import { createPinCodeBrowserLocalKeyring } from "./localKeyringPinCode";

const scope: LocalKeyringScope = {
  accountId: "user-1",
  namespace: "symcrypt-test",
  signingFingerprint: "signing-fingerprint-1",
};

test("PIN browser keyring round-trips an explicit manifest storage", async () => {
  const indexedDB = createFakeIndexedDb();
  const manifestStorage = createTestManifestStorage();
  const options = {
    indexedDB,
    kdfIterations: 1,
    manifestStorage,
    pinCode: () => "123456",
  };

  const session =
    await createPinCodeBrowserLocalKeyring(options).getOrCreateSession(scope);
  expect(session.manifest.rootKeyEnvelope.provider).toBe("pin-code");

  // The manifest must live in the explicit storage, not the IndexedDB
  // fallback: read it back through a store bound to that storage alone.
  const stored = await createLocalStorageLocalKeyringManifestStore({
    storage: manifestStorage,
  }).loadManifest(scope);
  expect(stored?.rootKeyEnvelope.provider).toBe("pin-code");

  const reopened =
    await createPinCodeBrowserLocalKeyring(options).loadSession(scope);
  expect(reopened).not.toBeNull();
  expect(reopened?.sqliteKey).toBe(session.sqliteKey);
});

test("PIN browser keyring defaults to the shared IndexedDB manifest backend", async () => {
  const indexedDB = createFakeIndexedDb();
  const options = {
    indexedDB,
    kdfIterations: 1,
    pinCode: () => "123456",
  };

  const session =
    await createPinCodeBrowserLocalKeyring(options).getOrCreateSession(scope);

  // The manifest must land where every browser-family reader looks: the
  // browser manifest store bound to the same IndexedDB. A drifted default
  // would strand PIN-wrapped manifests where no reader finds them.
  const manifest = await createBrowserLocalKeyringManifestStore({
    indexedDB,
  }).loadManifest(scope);
  expect(manifest?.rootKeyEnvelope.provider).toBe("pin-code");

  const reopened =
    await createPinCodeBrowserLocalKeyring(options).loadSession(scope);
  expect(reopened).not.toBeNull();
  expect(reopened?.sqliteKey).toBe(session.sqliteKey);
});
