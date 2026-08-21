import { afterEach, expect, test } from "bun:test";
import { createMemoryBlobStore, SymCrypt } from "@symcrypt/client-sdk";
import { createIdentitySeedPhraseFromEntropy } from "@symcrypt/crypto";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import { useSymCryptStoreSnapshot } from "../sdk/useSymCryptSubscription";
import { useGenerateKey } from "./localIdentityGeneration";
import { useLocalIdentityRestore } from "./localIdentityPersistence";
import {
  LocalIdentityRepository,
  type LocalIdentityStorage,
} from "./localIdentityRegistry";

afterEach(cleanup);

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createMemoryStorage(): LocalIdentityStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function createTestSymCrypt(): SymCrypt {
  return new SymCrypt({ blobStore: createMemoryBlobStore() });
}

test("identity generation stays in flight until registry persistence finishes", async () => {
  const persistenceStarted = createDeferred();
  const releasePersistence = createDeferred();
  const generationIdRef = { current: 0 };
  const generationInFlight = { current: false };
  const symcrypt = createTestSymCrypt();
  Reflect.set(symcrypt.session, "bootstrapLocalRootContainer", async () => ({
    containerId: "root",
    created: true,
  }));

  const view = renderHook(() =>
    useGenerateKey({
      ensureIdentityDatabaseReady: async () => undefined,
      generationIdRef,
      generationInFlight,
      persistLocalIdentity: async () => {
        persistenceStarted.resolve();
        await releasePersistence.promise;
      },
      symcrypt,
    }),
  );

  const generation = view.result.current();
  await persistenceStarted.promise;
  let generationSettled = false;
  void generation.then(() => {
    generationSettled = true;
  });

  expect(generationInFlight.current).toBe(true);
  expect(generationSettled).toBe(false);
  expect(await view.result.current()).toBe(false);

  releasePersistence.resolve();
  expect(await generation).toBe(true);
  expect(generationInFlight.current).toBe(false);
  symcrypt.dispose();
});

test("generates an identity key pair with the network down (offline)", async () => {
  // Key generation is purely local — seed -> key pair -> fingerprint -> local DB
  // -> local persistence — so it must succeed with no connectivity. Registration
  // is the only networked step and is deliberately separate. Guard that by
  // running the real generation with fetch forced to fail like an offline
  // WebView, asserting a key pair is produced and that generation makes no
  // network request at all.
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.reject(new TypeError("Failed to fetch"));
    // `typeof fetch` carries extra members (e.g. preconnect); cast through
    // unknown since this arg-ignoring stub only needs to be callable.
  }) as unknown as typeof globalThis.fetch;

  try {
    const generationIdRef = { current: 0 };
    const generationInFlight = { current: false };
    const symcrypt = createTestSymCrypt();
    Reflect.set(symcrypt.session, "bootstrapLocalRootContainer", async () => ({
      containerId: "root",
      created: true,
    }));

    const view = renderHook(() =>
      useGenerateKey({
        ensureIdentityDatabaseReady: async () => undefined,
        generationIdRef,
        generationInFlight,
        persistLocalIdentity: async () => undefined,
        symcrypt,
      }),
    );

    expect(await view.result.current()).toBe(true);
    expect(symcrypt.identity.signingKeyPair).not.toBeNull();
    expect(symcrypt.identity.encapsulationKeyPair).not.toBeNull();
    expect(fetchCalls).toBe(0);
    symcrypt.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("persisted identity restore completes after its key import rerenders", async () => {
  const repository = new LocalIdentityRepository({
    keyring: createSharedMemoryLocalKeyringFactory()(),
    scope: localIdentityScope("restore-rerender-test"),
    storage: createMemoryStorage(),
    storageKey: "identities",
  });
  const source = createTestSymCrypt();
  await source.identity.importSeedPhrase(
    createIdentitySeedPhraseFromEntropy(new Uint8Array(32).fill(0xab)),
  );
  const keyPackage = await source.identity.exportKeyPackage();
  await repository.upsert(keyPackage);

  const target = createTestSymCrypt();
  const generationIdRef = { current: 0 };
  const generationInFlight = { current: false };
  const view = renderHook(() => {
    useSymCryptStoreSnapshot(target.identity);
    return useLocalIdentityRestore({
      generationIdRef,
      generationInFlight,
      localPersistence: repository,
      symcrypt: target,
    });
  });

  await waitFor(() => {
    expect(view.result.current.restoreSettled).toBe(true);
    expect(view.result.current.restoredFingerprint).toBe(
      keyPackage.signingFingerprint,
    );
  });
  expect(target.identity.signingFingerprint).toBe(
    keyPackage.signingFingerprint,
  );
  expect(generationInFlight.current).toBe(false);

  source.dispose();
  target.dispose();
});

test("unlock reloads identity choices without replacing the live identity", async () => {
  const repository = new LocalIdentityRepository({
    keyring: createSharedMemoryLocalKeyringFactory()(),
    scope: localIdentityScope("unlock-registry-test"),
    storage: createMemoryStorage(),
    storageKey: "identities",
  });
  const identityA = createTestSymCrypt();
  const identityB = createTestSymCrypt();
  await identityA.identity.importSeedPhrase(
    createIdentitySeedPhraseFromEntropy(new Uint8Array(32).fill(0xab)),
  );
  await identityB.identity.importSeedPhrase(
    createIdentitySeedPhraseFromEntropy(new Uint8Array(32).fill(0xcd)),
  );
  const keyPackageA = await identityA.identity.exportKeyPackage();
  const keyPackageB = await identityB.identity.exportKeyPackage();
  await repository.upsert(keyPackageA);
  await repository.upsert(keyPackageB);

  const generationIdRef = { current: 0 };
  const generationInFlight = { current: false };
  const view = renderHook(
    ({ localPersistence }) =>
      useLocalIdentityRestore({
        generationIdRef,
        generationInFlight,
        localPersistence,
        symcrypt: identityA,
      }),
    {
      initialProps: {
        localPersistence: null as LocalIdentityRepository | null,
      },
    },
  );

  await waitFor(() => expect(view.result.current.restoreSettled).toBe(true));
  view.rerender({ localPersistence: repository });
  await waitFor(() => {
    expect(view.result.current.restoreSettled).toBe(true);
    expect(
      view.result.current.identities.map(
        (identity) => identity.signingFingerprint,
      ),
    ).toEqual([keyPackageA.signingFingerprint, keyPackageB.signingFingerprint]);
  });
  expect(identityA.identity.signingFingerprint).toBe(
    keyPackageA.signingFingerprint,
  );

  identityA.dispose();
  identityB.dispose();
});
