import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { withDatabaseStatementCounter } from "./databaseStatementCounter";
import { createDefaultManagedApiDatabase } from "./postgres";

const databaseUrlKey = "DATABASE_URL";
const postgresUrl = process.env[databaseUrlKey];
const backends = [
  { API_DATABASE: "sqlite", API_SQLITE_PATH: ":memory:" },
  { API_DATABASE: "memory" },
  ...(postgresUrl
    ? [{ API_DATABASE: "postgres", DATABASE_URL: postgresUrl }]
    : []),
];

for (const environment of backends) {
  test(`${environment.API_DATABASE} counts statement execution and visible transaction controls`, async () => {
    const managed = createDefaultManagedApiDatabase(environment);
    const transactionStatements = environment.API_DATABASE === "memory" ? 1 : 3;
    const outer = { statements: 0 };
    const inner = { statements: 0 };
    try {
      await withDatabaseStatementCounter(outer, async () => {
        await managed.db.execute(sql`select 1`);
        await withDatabaseStatementCounter(inner, () =>
          managed.db.transaction(async (tx) => {
            await tx.execute(sql`select 2`);
          }),
        );
      });
      expect(outer.statements).toBe(1 + transactionStatements);
      expect(inner.statements).toBe(transactionStatements);
      await managed.db.execute(sql`select 3`);
      expect(outer.statements).toBe(1 + transactionStatements);
      expect(inner.statements).toBe(transactionStatements);

      const failed = { statements: 0 };
      await expect(
        withDatabaseStatementCounter(failed, () =>
          managed.db.transaction(async (tx) => {
            await tx.execute(sql`select 4`);
            throw new Error("Rollback observation");
          }),
        ),
      ).rejects.toThrow("Rollback observation");
      expect(failed.statements).toBe(transactionStatements);
    } finally {
      await managed.close();
    }
  });

  test(`${environment.API_DATABASE} keeps concurrent request statement counts separate`, async () => {
    const managed = createDefaultManagedApiDatabase(environment);
    const first = { statements: 0 };
    const second = { statements: 0 };
    const resumed = Promise.withResolvers<void>();
    try {
      await Promise.all([
        withDatabaseStatementCounter(first, async () => {
          await resumed.promise;
          await managed.db.execute(sql`select 1`);
        }),
        withDatabaseStatementCounter(second, async () => {
          await managed.db.execute(sql`select 2`);
          resumed.resolve();
          await managed.db.execute(sql`select 3`);
        }),
      ]);
      expect(first.statements).toBe(1);
      expect(second.statements).toBe(2);
    } finally {
      await managed.close();
    }
  });
}
