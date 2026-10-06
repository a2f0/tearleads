import { expect, test } from "bun:test";
import {
  createLocalKeyring,
  createMemoryLocalKeyringManifestStore,
  createMemoryWrappingKeyKeystore,
  decodeLocalKeyringSqliteKey,
} from "@tearleads/client-sdk";
import { LOCAL_SQLITE_SCOPE_NAMESPACE } from "../local-keyring/localKeyringScopes";
import { createPrincipalHistoryKeyProvider } from "./principalHistoryKeyProvider";

const scope = {
  identityTrustDomain: "https://api.example.test",
  signingFingerprint: "signer-a",
};

function fixture() {
  const keystore = createMemoryWrappingKeyKeystore();
  const manifestStore = createMemoryLocalKeyringManifestStore();
  const create = () => createLocalKeyring({ keystore, manifestStore });
  return { create, provider: createPrincipalHistoryKeyProvider(create) };
}

test("recovery keys survive provider recreation and separate identity, API and SQLite purposes", async () => {
  const { create, provider } = fixture();
  const first = await provider(scope);
  expect(first).toHaveLength(32);
  expect(await createPrincipalHistoryKeyProvider(create)(scope)).toEqual(first);
  expect(
    await provider({ ...scope, signingFingerprint: "signer-b" }),
  ).not.toEqual(first);
  expect(
    await provider({
      ...scope,
      identityTrustDomain: "https://other.example.test",
    }),
  ).not.toEqual(first);
  const session = await create().getOrCreateSession({
    namespace: LOCAL_SQLITE_SCOPE_NAMESPACE,
  });
  try {
    expect(first).not.toEqual(decodeLocalKeyringSqliteKey(session.sqliteKey));
    expect(first).not.toEqual(session.blobStoreKey);
  } finally {
    session.dispose();
  }
  first.fill(0);
  expect(await provider(scope)).not.toEqual(first);
});

test("local key retirement changes the recovery key", async () => {
  const { create, provider } = fixture();
  const first = await provider(scope);
  await create().deleteSession({ namespace: LOCAL_SQLITE_SCOPE_NAMESPACE });
  expect(await provider(scope)).not.toEqual(first);
});

test("derivation keeps the host's shared keyring open for other consumers", async () => {
  const { create } = fixture();
  const shared = create();
  let closed = false;
  let factoryCalls = 0;
  const provider = createPrincipalHistoryKeyProvider(() => {
    factoryCalls += 1;
    return {
      close: () => {
        closed = true;
      },
      deleteSession: (scope) => shared.deleteSession(scope),
      loadSession: (scope) => shared.loadSession(scope),
      getOrCreateSession: (scope) => {
        if (closed) throw new Error("Host keyring closed during shared use");
        return shared.getOrCreateSession(scope);
      },
    };
  });
  await provider(scope);
  expect(closed).toBe(false);
  await provider(scope);
  expect(factoryCalls).toBe(1);
  expect(closed).toBe(false);
});

test("a locked provider fails without a fallback and can recover after unlock", async () => {
  const { create } = fixture();
  let locked = true;
  const provider = createPrincipalHistoryKeyProvider(() => {
    if (locked) throw new Error("Local keyring locked");
    return create();
  });
  await expect(provider(scope)).rejects.toThrow("Local keyring locked");
  locked = false;
  const [a, b] = await Promise.all([provider(scope), provider(scope)]);
  expect(a).toEqual(b);
  expect(a).not.toBe(b);
});
