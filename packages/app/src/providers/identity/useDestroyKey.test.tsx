import { afterEach, expect, spyOn, test } from "bun:test";
import { createMemoryBlobStore, Tearleads } from "@tearleads/client-sdk";
import { purgeOpfsSqliteDatabase } from "@tearleads/client-sdk/sqlite";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createDeferred } from "../../../test/helpers/databaseRuntimeFactories";
import { installIdentityDataTestStorage } from "../../../test/helpers/identityDataTestStorage";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import {
  clearPersistedCryptoSessionForIdentity,
  localCryptoSessionStorageKey,
} from "../crypto/localCryptoSessionPersistence";
import { sqliteDbNameForSigningFingerprint } from "../db/sqliteDbName";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import { LocalIdentityRepository } from "./localIdentityRegistry";
import { useDestroyKey } from "./useDestroyKey";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function provisionKeys(tearleads: Tearleads) {
  await tearleads.identity.setKeyPairs({
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
}

async function createFixture() {
  const tearleads = new Tearleads({
    blobStore: createMemoryBlobStore(),
    logger: { log: () => {}, logError: () => {} },
  });
  const repository = new LocalIdentityRepository({
    keyring: createSharedMemoryLocalKeyringFactory()(),
    scope: localIdentityScope("destroy-test"),
    storage: localStorage,
    storageKey: "destroy-test-registry",
  });
  await provisionKeys(tearleads);
  const identityB = await tearleads.identity.exportKeyPackage();
  await repository.upsert(identityB);
  await provisionKeys(tearleads);
  const identityA = await tearleads.identity.exportKeyPackage();
  await repository.upsert(identityA);
  const fingerprints = [
    identityA.signingFingerprint,
    identityB.signingFingerprint,
  ];
  const opfs = installIdentityDataTestStorage(fingerprints);
  const generationIdRef = { current: 0 };
  const generationInFlight = { current: false };
  const transitionInFlightRef = { current: false };
  const input = {
    generationIdRef,
    generationInFlight,
    transitionInFlightRef,
    localPersistence: repository,
    tearleads,
    onIdentitiesChanged: () => {},
    setTransitionInFlight: (_busy: boolean) => {},
    onIdentityRemoved: (signingFingerprint: string) =>
      clearPersistedCryptoSessionForIdentity({
        namespace: "destroy-test",
        signingFingerprint,
      }),
    purgeIdentityDatabase: (fp: string) =>
      purgeOpfsSqliteDatabase(sqliteDbNameForSigningFingerprint(fp)),
  };
  for (const fp of fingerprints) {
    localStorage.setItem(
      localCryptoSessionStorageKey("destroy-test", fp),
      "saved-session",
    );
  }
  return {
    identityA,
    identityB,
    input,
    opfs,
    repository,
    tearleads,
    dispose: () => {
      tearleads.dispose();
      opfs.restore();
    },
  };
}

test("destroy awaits the data wipe, removes only its identity, and stays keyless", async () => {
  const fixture = await createFixture();
  const { identityA, identityB, input, opfs, repository, tearleads } = fixture;
  const gate = createDeferred();
  const purge = input.purgeIdentityDatabase;
  input.purgeIdentityDatabase = async (fp) => {
    await gate.promise;
    await purge(fp);
  };
  const removed = spyOn(input, "onIdentityRemoved");
  const changed = spyOn(input, "onIdentitiesChanged");
  const view = renderHook(() => useDestroyKey(input));
  try {
    let destruction!: Promise<boolean>;
    act(() => {
      destruction = view.result.current.destroyKey(
        identityA.signingFingerprint,
      );
    });
    expect(input.generationIdRef.current).toBe(1);
    expect(input.generationInFlight.current).toBe(true);
    expect(input.transitionInFlightRef.current).toBe(true);
    expect(tearleads.identity.signingFingerprint).toBeNull();
    expect(view.result.current.identityDestroyed).toBe(true);
    expect((await repository.load()).identities).toHaveLength(2);
    expect(removed).not.toHaveBeenCalled();
    await act(async () => {
      expect(
        await view.result.current.destroyKey(identityB.signingFingerprint),
      ).toBe(false);
      gate.resolve();
      expect(await destruction).toBe(true);
    });
    expect(opfs.databases).toEqual(
      new Set([
        sqliteDbNameForSigningFingerprint(identityB.signingFingerprint).slice(
          1,
        ),
      ]),
    );
    expect(opfs.blobs).toEqual(new Set([identityB.signingFingerprint]));
    expect(removed).toHaveBeenCalledWith(identityA.signingFingerprint);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(
      localStorage.getItem(
        localCryptoSessionStorageKey(
          "destroy-test",
          identityA.signingFingerprint,
        ),
      ),
    ).toBeNull();
    expect(
      localStorage.getItem(
        localCryptoSessionStorageKey(
          "destroy-test",
          identityB.signingFingerprint,
        ),
      ),
    ).toBe("saved-session");
    expect((await repository.load()).activeSigningFingerprint).toBe(
      identityB.signingFingerprint,
    );
    expect(input.generationInFlight.current).toBe(false);
    expect(input.transitionInFlightRef.current).toBe(false);
    expect(tearleads.identity.signingFingerprint).toBeNull();
  } finally {
    gate.resolve();
    view.unmount();
    fixture.dispose();
  }
});

for (const failure of ["sqlite", "blobs", "registry"] as const) {
  test(`failed ${failure} deletion retains the identity for a fingerprint-scoped retry`, async () => {
    const fixture = await createFixture();
    const { identityA, identityB, input, opfs, repository, tearleads } =
      fixture;
    const view = renderHook(() => useDestroyKey(input));
    const remove = spyOn(repository, "remove");
    if (failure === "registry") {
      remove.mockRejectedValueOnce(new Error("registry unavailable"));
    } else {
      opfs.failNextRemoval(failure);
    }
    try {
      await act(async () => {
        await expect(
          view.result.current.destroyKey(identityA.signingFingerprint),
        ).rejects.toThrow();
      });
      expect((await repository.load()).identities).toHaveLength(2);
      expect(input.generationInFlight.current).toBe(false);
      expect(input.transitionInFlightRef.current).toBe(false);
      // Another identity can be selected after failure; retry must still target A.
      await tearleads.identity.importKeyPackage(identityB);
      await act(async () => {
        expect(
          await view.result.current.destroyKey(identityA.signingFingerprint),
        ).toBe(true);
      });
      expect(tearleads.identity.signingFingerprint).toBe(
        identityB.signingFingerprint,
      );
      expect(opfs.blobs).toEqual(new Set([identityB.signingFingerprint]));
      expect(opfs.databases).toEqual(
        new Set([
          sqliteDbNameForSigningFingerprint(identityB.signingFingerprint).slice(
            1,
          ),
        ]),
      );
      expect((await repository.load()).identities).toHaveLength(1);
    } finally {
      remove.mockRestore();
      view.unmount();
      fixture.dispose();
    }
  });
}

test("repeated creation and destruction leaves no identity data behind", async () => {
  const fixture = await createFixture();
  const { identityA, identityB, input, opfs, repository, tearleads } = fixture;
  const view = renderHook(() => useDestroyKey(input));
  try {
    for (const identity of [identityA, identityB]) {
      await act(async () => {
        await view.result.current.destroyKey(identity.signingFingerprint);
      });
    }
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await provisionKeys(tearleads);
      const identity = await tearleads.identity.exportKeyPackage();
      await repository.upsert(identity);
      opfs.databases.add(
        sqliteDbNameForSigningFingerprint(identity.signingFingerprint).slice(1),
      );
      opfs.blobs.add(identity.signingFingerprint);
      await act(async () => {
        expect(
          await view.result.current.destroyKey(identity.signingFingerprint),
        ).toBe(true);
      });
      expect(opfs.databases.size).toBe(0);
      expect(opfs.blobs.size).toBe(0);
      expect((await repository.load()).identities).toHaveLength(0);
    }
  } finally {
    view.unmount();
    fixture.dispose();
  }
});
