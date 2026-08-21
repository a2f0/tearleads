import { expect, test } from "bun:test";
import type { LocalKeyring, LocalKeyringSession } from "@symcrypt/client-sdk";
import { createSqliteCipherKeyResolver } from "./sqliteCipherKey";

function createStubKeyring(sqliteKey: string): {
  keyring: () => LocalKeyring;
  sessionCount: () => number;
  disposed: () => number;
} {
  let created = 0;
  let disposed = 0;
  const keyring: LocalKeyring = {
    close: () => {},
    deleteSession: async () => {},
    loadSession: async () => null,
    getOrCreateSession: async () => {
      created += 1;
      return {
        sqliteKey,
        dispose: () => {
          disposed += 1;
        },
      } as unknown as LocalKeyringSession;
    },
  };

  return {
    keyring: () => keyring,
    sessionCount: () => created,
    disposed: () => disposed,
  };
}

test("resolves the keyring session sqliteKey when a keyring is available", async () => {
  const stub = createStubKeyring("derived-sqlite-key");
  const resolve = createSqliteCipherKeyResolver(stub.keyring);

  expect(await resolve()).toBe("derived-sqlite-key");
  expect(await resolve()).toBe("derived-sqlite-key");
  // Each resolution opens and disposes a session.
  expect(stub.sessionCount()).toBe(2);
  expect(stub.disposed()).toBe(2);
});

test("throws a clear error when the keyring yields no session", async () => {
  const keyring: LocalKeyring = {
    close: () => {},
    deleteSession: async () => {},
    loadSession: async () => null,
    getOrCreateSession: async () =>
      null as unknown as Awaited<
        ReturnType<LocalKeyring["getOrCreateSession"]>
      >,
  };
  const resolve = createSqliteCipherKeyResolver(() => keyring);
  await expect(resolve()).rejects.toThrow(/keyring session/i);
});

test("recreates the keyring after a timed-out queued derivation", async () => {
  let closedStuckKeyrings = 0;
  const stuckKeyring: LocalKeyring = {
    close: () => {
      closedStuckKeyrings += 1;
      throw new Error("planned close failure");
    },
    deleteSession: async () => {},
    loadSession: async () => null,
    getOrCreateSession: () => new Promise(() => {}),
  };
  let disposed = 0;
  const healthyKeyring: LocalKeyring = {
    close: () => {},
    deleteSession: async () => {},
    loadSession: async () => null,
    getOrCreateSession: async () => {
      if (closedStuckKeyrings === 0) {
        throw new Error("Replacement keyring is blocked by the stale keyring.");
      }
      return {
        dispose: () => {
          disposed += 1;
        },
        sqliteKey: "recovered-sqlite-key",
      } as unknown as LocalKeyringSession;
    },
  };
  let cachedKeyring: LocalKeyring | null = null;
  let createdKeyrings = 0;
  let invalidations = 0;
  const createLocalKeyring = Object.assign(
    (): LocalKeyring => {
      cachedKeyring ??= ++createdKeyrings === 1 ? stuckKeyring : healthyKeyring;
      return cachedKeyring;
    },
    {
      invalidateCachedKeyring: () => {
        invalidations += 1;
        cachedKeyring = null;
      },
    },
  );
  const resolve = createSqliteCipherKeyResolver(createLocalKeyring, 5);

  const stuck = resolve();
  const queuedRetry = resolve();

  await expect(stuck).rejects.toThrow(/timed out after 5ms/i);
  await expect(queuedRetry).resolves.toBe("recovered-sqlite-key");
  expect(createdKeyrings).toBe(2);
  expect(invalidations).toBe(1);
  expect(closedStuckKeyrings).toBe(1);
  expect(disposed).toBe(1);
});

test("fails hard when no keyring is available (no development-key fallback)", async () => {
  // No keyring => no key. We must NOT silently encrypt with a development key
  // (which would later fail to decrypt once a keyring exists) and must NOT
  // downgrade to an in-memory database. Fail loudly instead.
  const resolve = createSqliteCipherKeyResolver(undefined);
  await expect(resolve()).rejects.toThrow(/local keyring is required/i);
});
