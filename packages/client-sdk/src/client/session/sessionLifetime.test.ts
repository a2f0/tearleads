import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sql } from "drizzle-orm";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { Tearleads } from "../../Tearleads";

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
    expect(fresh.state.domainScope).not.toBe(offline);
    expect(fresh.state.domainScope).not.toBe(first.state.domainScope);
    const read = fresh.infra.execSql("SELECT title FROM draft");
    finish.resolve();
    await expect(pending).rejects.toThrow();
    await expect(read).resolves.toEqual([{ title: "saved" }]);
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
