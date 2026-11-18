import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sql } from "drizzle-orm";
import { localSchemaMigrations } from "../../data/sqlite/migrations/localSchemaMigrations";
import { migrateLocalSchema } from "../../data/sqlite/migrations/migrateLocalSchema";
import { createExecSql } from "../../data/sqlite/sqlExec";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { Tearleads } from "../../Tearleads";
import { bootstrapRootContainer } from "../../workflows/registration/bootstrapRootContainer";

test("logout rolls back an unfinished local transaction before the next sign-in reads the same database", async () => {
  const sqlite = await createTestExecSql("sign-in-transaction");
  const sdk = new Tearleads({
    database: { execSql: sqlite.execSql, id: "shared" },
  });
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  try {
    sdk.session.setContext({ authToken: "first", isAuthenticated: true });
    const first = sdk.runtime.input();
    const old = getClientSQLitePersistenceRuntime(first.infra.execSql);
    await old.execSql("CREATE TABLE draft (title TEXT)");
    await old.execSql("INSERT INTO draft VALUES ('saved')");
    const pending = old.transaction(async (tx) => {
      await tx.run(sql`UPDATE draft SET title = 'unfinished'`);
      entered.resolve();
      await finish.promise;
    });
    await entered.promise;
    sdk.session.logout();
    const offline = sdk.domainScope;
    sdk.session.setContext({ authToken: "second", isAuthenticated: true });
    const fresh = sdk.runtime.input();
    const read = fresh.infra.execSql("SELECT title FROM draft");
    finish.resolve();
    await expect(pending).rejects.toThrow();
    await expect(read).resolves.toEqual([{ title: "saved" }]);
    expect(fresh.state.domainScope).not.toBe(offline);
    expect(fresh.state.domainScope).not.toBe(first.state.domainScope);
    await expect(
      old.execSql("INSERT INTO draft VALUES ('late')"),
    ).rejects.toThrow();
    await fresh.infra.execSql("INSERT INTO draft VALUES ('new')");
    expect(
      await fresh.infra.execSql("SELECT title FROM draft ORDER BY rowid"),
    ).toEqual([{ title: "saved" }, { title: "new" }]);
  } finally {
    finish.resolve();
    sdk.dispose();
    sqlite.close();
  }
});

test("the next sign-in can finish a schema migration interrupted at verification", async () => {
  const sqlite = await createTestExecSql("sign-in-migration");
  const sdk = new Tearleads({
    database: { execSql: sqlite.execSql, id: "legacy" },
  });
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  try {
    sdk.session.setContext({ authToken: "first", isAuthenticated: true });
    const old = sdk.runtime.input().infra.execSql;
    await old("CREATE TABLE draft (title TEXT)");
    const pending = migrateLocalSchema(old, {
      verify: async () => {
        entered.resolve();
        await finish.promise;
      },
    });
    await entered.promise;
    sdk.session.logout();
    sdk.session.setContext({ authToken: "second", isAuthenticated: true });
    const fresh = sdk.runtime.input().infra.execSql;
    finish.resolve();
    await expect(pending).rejects.toThrow();
    expect(
      await fresh(
        "SELECT name FROM sqlite_master WHERE name = 'local_schema_migrations'",
      ),
    ).toEqual([]);
    await migrateLocalSchema(fresh);
    expect(
      await fresh("SELECT count(*) AS total FROM local_schema_migrations"),
    ).toEqual([{ total: 1 + localSchemaMigrations.length }]);
  } finally {
    finish.resolve();
    sdk.dispose();
    sqlite.close();
  }
});

test("a new sign-in retains saved attachment bytes when a pending source is retired", async () => {
  const sdk = new Tearleads();
  const reading = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  try {
    sdk.session.setContext({ authToken: "first", isAuthenticated: true });
    const old = sdk.runtime.input().infra.blobStore;
    await old.writeBytes("attachment", Uint8Array.of(1));
    const pending = old.writeByteSource("attachment", {
      byteLength: 1,
      read: async () => {
        reading.resolve();
        await finish.promise;
        return Uint8Array.of(2);
      },
    });
    await reading.promise;
    sdk.session.logout();
    sdk.session.setContext({ authToken: "next", isAuthenticated: true });
    const fresh = sdk.runtime.input().infra.blobStore;
    finish.resolve();
    await expect(pending).rejects.toThrow();
    await expect(fresh.readBytes("attachment")).resolves.toEqual(
      Uint8Array.of(1),
    );
    await expect(old.deleteBytes("attachment")).rejects.toThrow();
    await fresh.writeBytes("attachment", Uint8Array.of(3));
    await expect(fresh.readBytes("attachment")).resolves.toEqual(
      Uint8Array.of(3),
    );
  } finally {
    finish.resolve();
    sdk.dispose();
  }
});

test("restoring an authenticated host session retires its previous scope with the same bearer", async () => {
  const sqlite = await createTestExecSql("host-session-restore");
  const sdk = new Tearleads({
    database: { execSql: sqlite.execSql, id: "shared" },
  });
  try {
    const restored = { authToken: "saved", isAuthenticated: true };
    sdk.session.setContext(restored);
    const current = sdk.session.captureSignIn();
    const first = sdk.runtime.input();
    await first.infra.execSql("CREATE TABLE draft (title TEXT)");
    await first.infra.execSql("INSERT INTO draft VALUES ('saved')");
    sdk.session.setContext(restored);
    expect(current()).toBe(false);
    expect(sdk.domainScope).not.toBe(first.state.domainScope);
    await expect(
      first.infra.execSql("SELECT title FROM draft"),
    ).rejects.toThrow();
    expect(
      await sdk.runtime.input().infra.execSql("SELECT title FROM draft"),
    ).toEqual([{ title: "saved" }]);
  } finally {
    sdk.dispose();
    sqlite.close();
  }
});

test("a completed local root lookup cannot replace a newer sign-in's root", async () => {
  const sqlite = await createTestExecSql("sign-in-local-root");
  await bootstrapRootContainer(sqlite.execSql);
  const reading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      const rows = await sqlite.execSql(
        sql,
        bind,
        rowMode ? { rowMode } : undefined,
      );
      if (/from "containers"/i.test(sql)) {
        reading.resolve();
        await release.promise;
      }
      return { rows };
    },
  });
  const sdk = new Tearleads({ database: { execSql, id: "shared" } });
  try {
    sdk.session.setContext({ authToken: "one", isAuthenticated: true });
    const pending = sdk.session.bootstrapLocalRootContainer();
    await reading.promise;
    sdk.session.setContext({
      authToken: "two",
      isAuthenticated: true,
      containerId: "current-root",
    });
    release.resolve();
    await expect(pending).rejects.toThrow();
    expect(sdk.session.containerId).toBe("current-root");
  } finally {
    release.resolve();
    sdk.dispose();
    sqlite.close();
  }
});

test("a delayed SQL read only delivers rows to its owning sign-in", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const execSql = createExecSql({
    async exec() {
      started.resolve();
      await release.promise;
      return { rows: [{ title: "saved" }] };
    },
  });
  const sdk = new Tearleads({ database: { execSql, id: "same" } });
  try {
    const signedIn = { authToken: "same", isAuthenticated: true };
    sdk.session.setContext(signedIn);
    const pending = sdk.runtime
      .input()
      .infra.execSql("SELECT title FROM draft");
    await started.promise;
    sdk.session.setContext(signedIn);
    release.resolve();
    await expect(pending).rejects.toThrow();
    await expect(
      sdk.runtime.input().infra.execSql("SELECT title FROM draft"),
    ).resolves.toEqual([{ title: "saved" }]);
  } finally {
    release.resolve();
    sdk.dispose();
  }
});
