import { expect, test } from "bun:test";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { readCommitLsnMode, readCurrentCommitLsn } from "./commitLsn";

test("Turso negotiates untracked LSNs without querying the database", async () => {
  const executor = {
    execute: () => {
      throw new Error("Turso commit LSN must not execute a query");
    },
  } as unknown as DatabaseSession;

  expect(
    await readCurrentCommitLsn(executor, "turso", {
      clientSupportsUntracked: true,
      minimumLsn: "0/20",
    }),
  ).toBe("0/0");
  expect(
    await readCurrentCommitLsn(executor, "turso", { minimumLsn: "0/20" }),
  ).toBe("0/20");
  expect(await readCurrentCommitLsn(executor, "turso")).toBe("0/0");
  expect(readCommitLsnMode("turso")).toBeUndefined();
  expect(readCommitLsnMode("turso", { clientSupportsUntracked: true })).toBe(
    "untracked",
  );
  expect(readCommitLsnMode("turso", { minimumLsn: "0/0" })).toBe("untracked");
  expect(readCommitLsnMode("turso", { minimumLsn: "0/20" })).toBeUndefined();
  expect(readCommitLsnMode("postgres")).toBe("tracked");
});

// The sqlite commitLsn counter is process-global; testing the startup seed needs
// a fresh module state, so this runs in a child process. It migrates an in-memory
// sqlite DB, inserts a document_updates row whose created_at is far in the future
// (simulating a write whose commitLsn a client persisted before a backward
// wall-clock step), then asserts readCurrentCommitLsn is seeded to at least that
// value rather than the (smaller) current wall clock.
test("sqlite commitLsn seeds from the latest persisted write's created_at", async () => {
  const commitLsnUrl = new URL("./commitLsn.ts", import.meta.url).href;
  const script = `
    const { createDefaultManagedApiDatabase } = await import("@tearleads/api-shared/postgres");
    const { documentUpdates } = await import("@tearleads/api-shared/schema");
    const { parseWalLsn } = await import("@tearleads/validators/util");
    const { readCurrentCommitLsn } = await import(${JSON.stringify(commitLsnUrl)});

    const managed = createDefaultManagedApiDatabase({
      API_DATABASE: "sqlite",
      API_SQLITE_PATH: ":memory:",
      SQLITE_PATH: ":memory:",
    });
    await managed.migrate();
    const db = managed.db;

    const futureMs = Date.now() + 1_000_000_000;
    await db.insert(documentUpdates).values({
      id: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      accessEpoch: 1,
      authorFingerprint: "fingerprint",
      encryptedData: "data",
      byteLength: 4,
      partialStartVersionVector: "{}",
      partialEndVersionVector: "{}",
      plaintextHash: "commit-lsn-plaintext-hash",
      createdAt: new Date(futureMs),
    });

    const lsn = await readCurrentCommitLsn(db);
    const parsed = parseWalLsn(lsn);
    if (parsed < BigInt(futureMs)) {
      throw new Error(
        "expected commitLsn seeded to >= " + futureMs + ", got " + lsn + " (" + parsed + ")",
      );
    }
    await managed.close();
  `;
  const child = Bun.spawn({
    cmd: ["bun", "-e", script],
    env: {
      ...process.env,
      API_DATABASE: "sqlite",
      API_SQLITE_PATH: ":memory:",
      SQLITE_PATH: ":memory:",
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ exitCode, stderr, stdout }).toMatchObject({ exitCode: 0 });
}, 15_000);
