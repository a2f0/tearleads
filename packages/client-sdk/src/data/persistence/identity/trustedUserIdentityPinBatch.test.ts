import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPin } from "../../../../test/helpers/trustedUserIdentityPin";
import {
  trustedUserIdentityPins,
  trustedUserIdentityPinTables,
} from "../../sqlite/schema/trustedUserIdentityPinSchema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { createExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { loadTrustedUserIdentityPins } from "./trustedUserIdentityPinBatch";

test("pin batch reads deduplicate, chunk bind variables and isolate trust domains", async () => {
  const database = await createTestExecSql("pin-read-batches");
  const statements: string[] = [];
  const readBindCounts: number[] = [];
  const execSql = createExecSql({
    async exec({ sql, bind, rowMode }) {
      statements.push(sql.toLowerCase());
      if (sql.toLowerCase().startsWith("select"))
        readBindCounts.push(
          Array.isArray(bind) ? bind.length : Object.keys(bind ?? {}).length,
        );
      return {
        rows: await database.execSql(
          sql,
          bind,
          rowMode ? { rowMode } : undefined,
        ),
      };
    },
  });
  try {
    await ensureSqlTables(execSql, trustedUserIdentityPinTables);
    const pins = Array.from({ length: 1001 }, (_, index) =>
      createPin({
        userId: `user-${index}`,
        signingKeyFingerprint: `signing-${index}`,
      }),
    );
    const first = pins[0];
    if (!first) throw new Error("Missing pin");
    await getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
      for (const pin of pins)
        await tx.insert(trustedUserIdentityPins).values(pin).run();
      await tx
        .insert(trustedUserIdentityPins)
        .values({
          ...first,
          identityTrustDomain: "https://other.example.test",
          encapsulationPublicKey: "other-domain",
        })
        .run();
    });
    statements.length = 0;
    const read = await loadTrustedUserIdentityPins({
      execSql,
      identityTrustDomain: first.identityTrustDomain,
      userIds: [...pins.map((pin) => pin.userId), first.userId, "missing-user"],
    });
    expect(read.size).toBe(pins.length);
    expect(read.has("missing-user")).toBe(false);
    expect(Math.max(...readBindCounts)).toBeLessThanOrEqual(999);
    expect(read.get(first.userId)).toEqual(first);
    expect(statements.filter((sql) => sql.startsWith("select"))).toHaveLength(
      2,
    );
    expect(statements.filter((sql) => sql.startsWith("begin"))).toEqual([
      "begin",
    ]);
    expect(statements.some((sql) => /^(insert|update|delete)/.test(sql))).toBe(
      false,
    );
    statements.length = 0;
    expect(
      (
        await loadTrustedUserIdentityPins({
          execSql,
          identityTrustDomain: first.identityTrustDomain,
          userIds: [],
        })
      ).size,
    ).toBe(0);
    expect(statements).toEqual([]);
  } finally {
    database.close();
  }
});

for (const secondAdapter of [false, true]) {
  test(`batch read never trusts a rolled-back pin: second adapter=${secondAdapter}`, async () => {
    const database = await createTestExecSql("pin-batch-rollback");
    const release = Promise.withResolvers<void>();
    const inserted = Promise.withResolvers<void>();
    const attempted = Promise.withResolvers<void>();
    let watchBegin = false;
    const pin = createPin();
    const writer = createExecSql({
      async exec({ sql, bind, rowMode }) {
        return {
          rows: await database.execSql(
            sql,
            bind,
            rowMode ? { rowMode } : undefined,
          ),
        };
      },
    });
    const reader = secondAdapter
      ? createExecSql({
          async exec({ sql, bind, rowMode }) {
            if (watchBegin && sql.toLowerCase() === "begin")
              attempted.resolve();
            const rows = await database.execSql(
              sql,
              bind,
              rowMode ? { rowMode } : undefined,
            );
            if (watchBegin && sql.toLowerCase().startsWith("select"))
              attempted.resolve();
            return { rows };
          },
        })
      : writer;
    let write: Promise<unknown> | undefined;
    let read: Promise<unknown> | undefined;
    try {
      await ensureSqlTables(writer, trustedUserIdentityPinTables);
      // Prewarm schema before holding the write, so BEGIN is the next boundary.
      await loadTrustedUserIdentityPins({
        execSql: reader,
        ...pin,
        userIds: [pin.userId],
      });
      write = getClientSQLitePersistenceRuntime(writer)
        .transaction(async (tx) => {
          await tx.insert(trustedUserIdentityPins).values(pin).run();
          inserted.resolve();
          await release.promise;
          throw new Error("rollback pin");
        })
        .catch((error: unknown) => error);
      await inserted.promise;
      watchBegin = true;
      let answered = false;
      read = loadTrustedUserIdentityPins({
        execSql: reader,
        ...pin,
        userIds: [pin.userId],
      }).then((pins) => {
        answered = true;
        return pins;
      });
      if (secondAdapter) await attempted.promise;
      // The same adapter queues behind the open mutation; another adapter's
      // BEGIN is refused by SQLite. Neither may return an uncommitted row.
      await Promise.resolve();
      expect(answered).toBe(false);
      release.resolve();
      expect(await write).toMatchObject({ message: "rollback pin" });
      expect(await read).toEqual(new Map());
    } finally {
      release.resolve();
      await Promise.allSettled([write, read]);
      database.close();
    }
  });
}
