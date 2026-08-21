import { expect, test } from "bun:test";
import {
  createLocalKeyring,
  createMemoryLocalKeyringManifestStore,
  createMemoryWrappingKeyKeystore,
  type LocalKeyringManifestStore,
  type LocalKeyringScope,
  type WrappingKeyKeystore,
} from "./index";
import { createPinCodeWrappingKeyKeystore } from "./localKeyringPinCode";

const scope: LocalKeyringScope = {
  accountId: "user-1",
  namespace: "symcrypt-test",
  signingFingerprint: "signing-fingerprint-1",
};

function createPinCodeTestKeyring(input: {
  readonly innerKeystore: WrappingKeyKeystore;
  readonly manifestStore: LocalKeyringManifestStore;
  readonly pinCode: () => string;
}) {
  return createLocalKeyring({
    keystore: createPinCodeWrappingKeyKeystore({
      innerKeystore: input.innerKeystore,
      kdfIterations: 1,
      pinCode: input.pinCode,
    }),
    manifestStore: input.manifestStore,
  });
}

test("PIN code wrapping keyring requires the matching PIN to reload", async () => {
  const innerKeystore = createMemoryWrappingKeyKeystore();
  const manifestStore = createMemoryLocalKeyringManifestStore();
  let pinCode = "123456";
  const keyring = createPinCodeTestKeyring({
    innerKeystore,
    manifestStore,
    pinCode: () => pinCode,
  });
  const session = await keyring.getOrCreateSession(scope);
  const manifest = await manifestStore.loadManifest(scope);
  if (!manifest) {
    throw new Error("Expected local keyring manifest.");
  }

  expect(manifest.rootKeyEnvelope.provider).toBe("pin-code");
  expect(manifest.rootKeyEnvelope.algorithm).toBe(
    "pin-code-pbkdf2-sha256-aes-256-gcm",
  );
  expect(manifest.rootKeyEnvelope.keyId.startsWith("pin-code:")).toBe(true);

  pinCode = "000000";
  await expect(
    createPinCodeTestKeyring({
      innerKeystore,
      manifestStore,
      pinCode: () => pinCode,
    }).loadSession(scope),
  ).rejects.toThrow("PIN code");

  pinCode = "123456";
  const reopened = await createPinCodeTestKeyring({
    innerKeystore,
    manifestStore,
    pinCode: () => pinCode,
  }).loadSession(scope);
  expect(reopened).not.toBeNull();
  if (!reopened) {
    throw new Error("Expected reopened PIN code local keyring session.");
  }
  expect(reopened.sqliteKey).toBe(session.sqliteKey);
  expect(reopened.blobStoreKey).toEqual(session.blobStoreKey);
  expect(reopened.identityPersistenceKey).toEqual(
    session.identityPersistenceKey,
  );
});

test("PIN code wrapping keyring still requires the inner wrapping key", async () => {
  const manifestStore = createMemoryLocalKeyringManifestStore();
  const pinCode = () => "123456";
  await createPinCodeTestKeyring({
    innerKeystore: createMemoryWrappingKeyKeystore(),
    manifestStore,
    pinCode,
  }).getOrCreateSession(scope);

  await expect(
    createPinCodeTestKeyring({
      innerKeystore: createMemoryWrappingKeyKeystore(),
      manifestStore,
      pinCode,
    }).loadSession(scope),
  ).rejects.toThrow("Wrapping key is unavailable");
});
