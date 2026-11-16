import { afterEach, expect, mock, test } from "bun:test";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import {
  type AccountNamingPersistence,
  claimAccountNamingWrite,
  clearPersistedAccountNamingForIdentity,
  loadPersistedAccountNaming,
  savePersistedAccountNaming,
  sealPendingAccountNaming,
} from "./accountNamingPersistence";

const NAMESPACE = "account-naming-test";
const FINGERPRINT = "fp-removed";

afterEach(() => {
  globalThis.localStorage.clear();
});

function persistence(): AccountNamingPersistence {
  return {
    keyring: createSharedMemoryLocalKeyringFactory()(),
    scope: localIdentityScope(NAMESPACE),
    storage: globalThis.localStorage,
    storageKey: `tearleads.account-naming:${NAMESPACE}:${FINGERPRINT}`,
  };
}

test("sealing a new identity's prompt leaves the host's shared keyring open", async () => {
  const shared = createSharedMemoryLocalKeyringFactory()();
  const close = mock(() => {});
  const keyring = { ...shared, close };
  await sealPendingAccountNaming({
    createLocalKeyring: () => keyring,
    namespace: NAMESPACE,
    signingFingerprint: FINGERPRINT,
  });
  expect(close).not.toHaveBeenCalled();
  expect(
    await loadPersistedAccountNaming(
      { ...persistence(), keyring },
      FINGERPRINT,
    ),
  ).toEqual({ status: "awaiting" });
});

test("removing an identity drops its sealed name, even a seal still in flight", async () => {
  const sealed = persistence();
  await savePersistedAccountNaming(sealed, FINGERPRINT, { status: "awaiting" });
  expect(await loadPersistedAccountNaming(sealed, FINGERPRINT)).toEqual({
    status: "awaiting",
  });

  const inFlight = savePersistedAccountNaming(sealed, FINGERPRINT, {
    name: "Bob",
    status: "named",
  });
  clearPersistedAccountNamingForIdentity({
    namespace: NAMESPACE,
    signingFingerprint: FINGERPRINT,
  });
  await inFlight;

  expect(globalThis.localStorage.getItem(sealed.storageKey)).toBeNull();
  expect(await loadPersistedAccountNaming(sealed, FINGERPRINT)).toBeNull();
});

test("a seal queued before its identity was removed does not write once it runs", async () => {
  const sealed = persistence();
  const queued = claimAccountNamingWrite(sealed);
  clearPersistedAccountNamingForIdentity({
    namespace: NAMESPACE,
    signingFingerprint: FINGERPRINT,
  });
  expect(
    await savePersistedAccountNaming(
      sealed,
      FINGERPRINT,
      { name: "Bob", status: "named" },
      queued,
    ),
  ).toBe(false);
  expect(globalThis.localStorage.getItem(sealed.storageKey)).toBeNull();
});

test("a seal queued in a runtime since replaced never lands over the replacement's", async () => {
  // The first runtime queued a seal and unmounted before it ran; its
  // replacement, a separate handle on the same record, sealed the name since.
  const replaced = persistence();
  const stale = claimAccountNamingWrite(replaced);
  const replacement = persistence();
  expect(
    await savePersistedAccountNaming(replacement, FINGERPRINT, {
      name: "Bob",
      status: "named",
    }),
  ).toBe(true);

  expect(
    await savePersistedAccountNaming(
      replaced,
      FINGERPRINT,
      { status: "awaiting" },
      stale,
    ),
  ).toBe(false);
  expect(await loadPersistedAccountNaming(replacement, FINGERPRINT)).toEqual({
    name: "Bob",
    status: "named",
  });
});

test("a sealed name reads back only for its own identity", async () => {
  const sealed = persistence();
  await savePersistedAccountNaming(sealed, FINGERPRINT, {
    name: "Bob",
    status: "named",
  });
  expect(await loadPersistedAccountNaming(sealed, FINGERPRINT)).toEqual({
    name: "Bob",
    status: "named",
  });
  // A record under this key that names another identity is no record of
  // this one's, and is not taken as none either.
  await expect(loadPersistedAccountNaming(sealed, "fp-other")).rejects.toThrow(
    "unreadable",
  );
});
