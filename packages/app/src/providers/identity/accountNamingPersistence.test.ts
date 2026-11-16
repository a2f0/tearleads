import { afterEach, expect, test } from "bun:test";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import {
  type AccountNamingPersistence,
  accountNamingRemoval,
  clearPersistedAccountNamingForIdentity,
  loadPersistedAccountNaming,
  savePersistedAccountNaming,
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
  const queuedAt = accountNamingRemoval(sealed);
  clearPersistedAccountNamingForIdentity({
    namespace: NAMESPACE,
    signingFingerprint: FINGERPRINT,
  });
  await savePersistedAccountNaming(
    sealed,
    FINGERPRINT,
    { name: "Bob", status: "named" },
    queuedAt,
  );
  expect(globalThis.localStorage.getItem(sealed.storageKey)).toBeNull();
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
  // A record under this key that names another identity is dropped.
  expect(await loadPersistedAccountNaming(sealed, "fp-other")).toBeNull();
  expect(globalThis.localStorage.getItem(sealed.storageKey)).toBeNull();
});
