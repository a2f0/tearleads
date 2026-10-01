import { expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import {
  type LocalCryptoSessionPersistence,
  localCryptoSessionStorageKey,
  persistCryptoSession,
  restorePersistedCryptoSession,
} from "./localCryptoSessionPersistence";
import { usePrepareForRestoreReload } from "./usePrepareForRestoreReload";

const signingFingerprint = "d".repeat(64);

async function sessionFixture() {
  const namespace = `prepare-reload-${crypto.randomUUID()}`;
  const keyring = createSharedMemoryLocalKeyringFactory()();
  const scope = localIdentityScope(namespace);
  (await keyring.getOrCreateSession(scope)).dispose();
  const values = new Map<string, string>();
  const localPersistence: LocalCryptoSessionPersistence = {
    keyring,
    scope,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => {
        values.delete(key);
      },
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    storageKey: localCryptoSessionStorageKey(namespace, signingFingerprint),
  };
  const sessionState = {
    authToken: "token-1",
    containerId: "pre-restore-root",
    defaultOrganizationId: "org-1",
    isAuthenticated: true,
    isRoot: false,
    organizationId: "org-1",
    rootAcknowledgments: [
      {
        signingFingerprint,
        userId: "user-1",
        organizationId: "org-1",
        rootContainerId: "server-root",
      },
    ],
    userId: "user-1",
    userIdAcknowledged: true,
  };
  expect(
    await persistCryptoSession({
      context: sessionState,
      localPersistence,
      signingFingerprint,
    }),
  ).toBe(true);
  return { localPersistence, sessionState, values };
}

function renderPrepare(
  fixture: Awaited<ReturnType<typeof sessionFixture>>,
  restoreSettled = true,
) {
  return renderHook(() =>
    usePrepareForRestoreReload({
      localPersistence: fixture.localPersistence,
      restoreSettled,
      sessionState: fixture.sessionState,
      signingFingerprint,
    }),
  ).result.current;
}

test("a repeated reload click keeps the signed-out record with its acknowledgements", async () => {
  const fixture = await sessionFixture();
  const prepare = renderPrepare(fixture);

  await Promise.all([prepare(), prepare()]);
  await prepare();

  const restored = await restorePersistedCryptoSession({
    localPersistence: fixture.localPersistence,
    signingFingerprint,
  });
  expect(restored?.isAuthenticated).toBe(false);
  expect(restored?.containerId).toBeNull();
  expect(restored?.rootAcknowledgments).toEqual(
    fixture.sessionState.rootAcknowledgments,
  );
});

test("a record that cannot be rewritten is dropped rather than pin the old root", async () => {
  const fixture = await sessionFixture();
  // The keyring holds no session for this scope, so the write cannot encrypt.
  const locked = {
    ...fixture,
    localPersistence: {
      ...fixture.localPersistence,
      keyring: {
        ...fixture.localPersistence.keyring,
        loadSession: async () => null,
      },
    },
  };

  await renderPrepare(locked)();

  expect(fixture.values.has(fixture.localPersistence.storageKey)).toBe(false);
});

test("before the saved session loads, the record is dropped, not overwritten", async () => {
  const fixture = await sessionFixture();

  await renderPrepare(fixture, false)();

  expect(fixture.values.has(fixture.localPersistence.storageKey)).toBe(false);
});
