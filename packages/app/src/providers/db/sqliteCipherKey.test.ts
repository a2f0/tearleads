import { expect, test } from "bun:test";
import type { LocalKeyring, LocalKeyringSession } from "@tearleads/client-sdk";
import { createSqliteCipherKeyResolver } from "./sqliteCipherKey";

function createStubKeyring(sqliteKey: string): {
  keyring: () => LocalKeyring;
  sessionCount: () => number;
  disposed: () => number;
} {
  let created = 0;
  let disposed = 0;
  const keyring: LocalKeyring = {
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

test("fails hard when no keyring is available (no development-key fallback)", async () => {
  // No keyring => no key. We must NOT silently encrypt with a development key
  // (which would later fail to decrypt once a keyring exists) and must NOT
  // downgrade to an in-memory database. Fail loudly instead.
  const resolve = createSqliteCipherKeyResolver(undefined);
  await expect(resolve()).rejects.toThrow(/local keyring is required/i);
});
