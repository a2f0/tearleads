import { afterAll, beforeAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDefaultManagedApiDatabase } from "./postgres";
import { databaseTransactionCompletion } from "./transactionCompletion";

for (const kind of ["memory", "sqlite"] as const) {
  const managed = createDefaultManagedApiDatabase({
    API_DATABASE: kind,
    API_SQLITE_PATH: ":memory:",
  });
  beforeAll(async () => {
    await managed.db.execute(
      sql`CREATE TABLE completion_events (id text PRIMARY KEY)`,
    );
  });
  afterAll(async () => {
    await managed.close();
  });

  test(`${kind}: completion runs after committed writes are visible to the root`, async () => {
    const observed: boolean[] = [];
    const errors: unknown[] = [];
    const result = await managed.db.transaction(async (tx) => {
      const completion = databaseTransactionCompletion(tx);
      if (!completion) throw new Error("missing completion scope");
      await tx.execute(sql`INSERT INTO completion_events VALUES ('committed')`);
      completion.defer(
        async (committed) => {
          observed.push(committed);
          const rows = await completion.root.execute(
            sql`SELECT id FROM completion_events WHERE id = 'committed'`,
          );
          expect(rows.rows).toHaveLength(1);
          await completion.root.execute(
            sql`INSERT INTO completion_events VALUES ('after-commit')`,
          );
        },
        (error) => {
          errors.push(error);
        },
      );
      expect(observed).toEqual([]);
      return "committed-result";
    });
    expect(result).toBe("committed-result");
    expect(observed).toEqual([true]);
    expect(errors).toEqual([]);
    expect(
      (
        await managed.db.execute(
          sql`SELECT id FROM completion_events WHERE id = 'after-commit'`,
        )
      ).rows,
    ).toHaveLength(1);
  });

  test(`${kind}: failed cache publication cannot change a committed result`, async () => {
    const errors: unknown[] = [];
    const result = await managed.db.transaction(async (tx) => {
      const completion = databaseTransactionCompletion(tx);
      if (!completion) throw new Error("missing completion scope");
      await tx.execute(
        sql`INSERT INTO completion_events VALUES ('cache-failure')`,
      );
      completion.defer(
        async () => {
          throw new Error("cache unavailable");
        },
        (error) => {
          errors.push(error);
        },
      );
      return "successful-mutation";
    });
    expect(result).toBe("successful-mutation");
    expect(errors).toHaveLength(1);
    expect(
      (
        await managed.db.execute(
          sql`SELECT id FROM completion_events WHERE id = 'cache-failure'`,
        )
      ).rows,
    ).toHaveLength(1);
  });

  test(`${kind}: rollback completion sees rolled-back state and preserves the original error`, async () => {
    const observed: boolean[] = [];
    const errors: unknown[] = [];
    await expect(
      managed.db.transaction(async (tx) => {
        const completion = databaseTransactionCompletion(tx);
        if (!completion) throw new Error("missing completion scope");
        await tx.execute(
          sql`INSERT INTO completion_events VALUES ('rolled-back')`,
        );
        completion.defer(
          async (committed) => {
            observed.push(committed);
            expect(
              (
                await completion.root.execute(
                  sql`SELECT id FROM completion_events WHERE id = 'rolled-back'`,
                )
              ).rows,
            ).toHaveLength(0);
          },
          (error) => {
            errors.push(error);
          },
        );
        throw new Error("original transaction failure");
      }),
    ).rejects.toThrow("original transaction failure");
    expect(observed).toEqual([false]);
    expect(errors).toEqual([]);
  });

  test(`${kind}: savepoint effects wait for the outer transaction and retain rollback status`, async () => {
    const observed: [string, boolean][] = [];
    const errors: unknown[] = [];
    for (const abortOuter of [false, true]) {
      const work = managed.db.transaction(async (tx) => {
        await tx.transaction(async (nested) => {
          const completion = databaseTransactionCompletion(nested);
          if (!completion) throw new Error("missing nested completion scope");
          completion.defer(
            async (committed) => {
              observed.push(["released", committed]);
            },
            (error) => {
              errors.push(error);
            },
          );
        });
        await expect(
          tx.transaction(async (nested) => {
            const completion = databaseTransactionCompletion(nested);
            if (!completion) throw new Error("missing nested completion scope");
            completion.defer(
              async (committed) => {
                observed.push(["rolled-back", committed]);
              },
              (error) => {
                errors.push(error);
              },
            );
            throw new Error("savepoint rollback");
          }),
        ).rejects.toThrow("savepoint rollback");
        expect(observed).toEqual([]);
        if (abortOuter) throw new Error("outer rollback");
      });
      if (abortOuter) await expect(work).rejects.toThrow("outer rollback");
      else await work;
      expect(observed).toEqual([
        ["released", !abortOuter],
        ["rolled-back", false],
      ]);
      observed.length = 0;
    }
    expect(errors).toEqual([]);
  });
}
