import { expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { createSharedMemoryLocalKeyringFactory } from "../../../test/helpers/sharedMemoryLocalKeyring";
import { localIdentityScope } from "../local-keyring/localKeyringScopes";
import {
  type LocalCryptoSessionPersistence,
  localCryptoSessionStorageKey,
  persistCryptoSession,
  queueCryptoSessionPersistence,
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
  fixture: Pick<
    Awaited<ReturnType<typeof sessionFixture>>,
    "localPersistence" | "sessionState"
  >,
  restoreSettled = true,
  writeTimeoutMs?: number,
) {
  return renderHook(() =>
    usePrepareForRestoreReload({
      localPersistence: fixture.localPersistence,
      restoreSettled,
      sessionState: fixture.sessionState,
      signingFingerprint,
      writeTimeoutMs,
    }),
  ).result.current;
}

async function expectSignedOutRecordKeepsAcknowledgements(
  fixture: Awaited<ReturnType<typeof sessionFixture>>,
) {
  const restored = await restorePersistedCryptoSession({
    localPersistence: fixture.localPersistence,
    signingFingerprint,
  });
  expect(restored?.isAuthenticated).toBe(false);
  expect(restored?.containerId).toBeNull();
  expect(restored?.rootAcknowledgments).toEqual(
    fixture.sessionState.rootAcknowledgments,
  );
}

test("a repeated reload click keeps the signed-out record with its acknowledgements", async () => {
  const fixture = await sessionFixture();
  const prepare = renderPrepare(fixture);

  expect(await Promise.all([prepare(), prepare()])).toEqual([null, null]);
  expect(await prepare()).toBeNull();

  await expectSignedOutRecordKeepsAcknowledgements(fixture);
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

  expect(await renderPrepare(locked)()).toBe("rewrite_failed");

  expect(fixture.values.has(fixture.localPersistence.storageKey)).toBe(false);
});

test("before the saved session loads, the saved record is rewritten signed out", async () => {
  const fixture = await sessionFixture();
  // The live state has not loaded the saved record yet, so it holds nothing.
  const unloaded = {
    ...fixture,
    sessionState: { ...fixture.sessionState, rootAcknowledgments: [] },
  };

  expect(await renderPrepare(unloaded, false)()).toBeNull();

  await expectSignedOutRecordKeepsAcknowledgements(fixture);
});

test("with no saved session there is nothing to keep or report", async () => {
  const fixture = await sessionFixture();
  fixture.values.clear();

  expect(await renderPrepare(fixture, false)()).toBeNull();
  expect(fixture.values.size).toBe(0);
});

test("a stalled earlier write cannot hold the reload, and cannot land after it", async () => {
  const fixture = await sessionFixture();
  const { keyring, scope } = fixture.localPersistence;
  let release: (
    session: Awaited<ReturnType<typeof keyring.loadSession>>,
  ) => void = () => undefined;
  const stalledWrite = queueCryptoSessionPersistence({
    context: fixture.sessionState,
    localPersistence: {
      ...fixture.localPersistence,
      keyring: {
        ...keyring,
        loadSession: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
    },
    signingFingerprint,
  });

  expect(await renderPrepare(fixture, true, 20)()).toBe("rewrite_timed_out");
  expect(fixture.values.has(fixture.localPersistence.storageKey)).toBe(false);

  release(await keyring.loadSession(scope));
  expect(await stalledWrite).toBe(false);
  expect(fixture.values.has(fixture.localPersistence.storageKey)).toBe(false);
});
