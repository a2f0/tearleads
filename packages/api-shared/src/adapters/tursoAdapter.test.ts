import { expect, test } from "bun:test";
import type {
  Client,
  InStatement,
  ResultSet,
  Row,
  Transaction,
} from "@libsql/client/ws";
import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { unsafeCoerce } from "../unsafeCoerce.js";
import {
  attachTursoDatabaseBridge,
  enforceTursoForeignKeys,
  forceTursoWriteTransactions,
  normalizeTursoResultIntegers,
  readTursoConnectionConfig,
} from "./tursoAdapter";
import type { ApiSchema } from "./types";

test("Turso connection config requires a remote database URL", () => {
  expect(() =>
    readTursoConnectionConfig({ TURSO_AUTH_TOKEN: "test-token" }),
  ).toThrow("TURSO_DATABASE_URL is required when API_DATABASE=turso");
  expect(() =>
    readTursoConnectionConfig({
      TURSO_AUTH_TOKEN: "test-token",
      TURSO_DATABASE_URL: "file:local.db",
    }),
  ).toThrow(
    "TURSO_DATABASE_URL must use libsql://; local files and embedded replicas are not supported",
  );
});

test("Turso connection config requires authentication", () => {
  expect(() =>
    readTursoConnectionConfig({
      TURSO_DATABASE_URL: "libsql://test-database.turso.io",
      TURSO_PRIMARY_INSTANCE_ID: "0be90471-6906-11ee-8553-eaa7715aeaf2",
    }),
  ).toThrow("TURSO_AUTH_TOKEN is required when API_DATABASE=turso");
});

test("Turso connection config requires TLS and separate authentication", () => {
  expect(() =>
    readTursoConnectionConfig({
      TURSO_AUTH_TOKEN: "test-token",
      TURSO_DATABASE_URL: "libsql://localhost:8080?tls=0",
    }),
  ).toThrow("TURSO_DATABASE_URL must not disable TLS");
  expect(() =>
    readTursoConnectionConfig({
      TURSO_AUTH_TOKEN: "test-token",
      TURSO_DATABASE_URL: "libsql://test-database.turso.io?authToken=url-token",
    }),
  ).toThrow("TURSO_DATABASE_URL must not contain authToken");
  expect(() =>
    readTursoConnectionConfig({
      TURSO_AUTH_TOKEN: "test-token",
      TURSO_DATABASE_URL:
        "libsql://url-user:url-password@test-database.turso.io",
    }),
  ).toThrow("TURSO_DATABASE_URL must not contain userinfo credentials");
});

test("Turso connection config trims remote credentials", () => {
  expect(
    readTursoConnectionConfig({
      TURSO_AUTH_TOKEN: " test-token ",
      TURSO_DATABASE_URL: " libsql://test-database.turso.io ",
      TURSO_PRIMARY_INSTANCE_ID: " 0be90471-6906-11ee-8553-eaa7715aeaf2 ",
    }),
  ).toEqual({
    authToken: "test-token",
    intMode: "bigint",
    tls: true,
    url: "libsql://0be90471-6906-11ee-8553-eaa7715aeaf2-test-database.turso.io",
  });
});

test("Turso connection config requires a managed primary instance", () => {
  expect(() =>
    readTursoConnectionConfig({
      TURSO_AUTH_TOKEN: "test-token",
      TURSO_DATABASE_URL: "libsql://libsql.example.com",
      TURSO_PRIMARY_INSTANCE_ID: "0be90471-6906-11ee-8553-eaa7715aeaf2",
    }),
  ).toThrow("must identify a managed Turso database");
  expect(() =>
    readTursoConnectionConfig({
      TURSO_AUTH_TOKEN: "test-token",
      TURSO_DATABASE_URL: "libsql://test-database.turso.io",
    }),
  ).toThrow("TURSO_PRIMARY_INSTANCE_ID is required when API_DATABASE=turso");
  expect(() =>
    readTursoConnectionConfig({
      TURSO_AUTH_TOKEN: "test-token",
      TURSO_DATABASE_URL: "libsql://test-database.turso.io",
      TURSO_PRIMARY_INSTANCE_ID: "not-an-instance-id",
    }),
  ).toThrow("must be the UUID of the database's primary instance");
});

test("Turso transactions always request write mode", async () => {
  let requestedMode: string | undefined;
  const client = unsafeCoerce<Client>({
    transaction: async (mode: string) => {
      requestedMode = mode;
      return unsafeCoerce<Transaction>({});
    },
  });

  await forceTursoWriteTransactions(client).transaction();

  expect(requestedMode).toBe("write");
});

function resultSet(values: readonly bigint[]): ResultSet {
  const row = unsafeCoerce<Row>([...values]);
  return unsafeCoerce<ResultSet>({ rows: [row] });
}

test("Turso enables foreign keys on deferred root reads", async () => {
  const calls: string[] = [];
  let applicationStatement: InStatement | undefined;
  const createTransaction = (): Transaction => {
    let foreignKeysEnabled = false;
    return unsafeCoerce<Transaction>({
      close: () => calls.push("close"),
      commit: async () => {
        calls.push("commit");
      },
      execute: async (statement: InStatement) => {
        const query = typeof statement === "string" ? statement : statement.sql;
        calls.push(`execute:${query}`);
        if (query !== "PRAGMA foreign_keys") {
          applicationStatement = statement;
        }
        return query === "PRAGMA foreign_keys"
          ? resultSet([foreignKeysEnabled ? 1n : 0n])
          : resultSet([1n]);
      },
      executeMultiple: async (statement: string) => {
        calls.push(`executeMultiple:${statement}`);
        foreignKeysEnabled = statement.includes("PRAGMA foreign_keys = ON");
      },
      rollback: async () => {
        calls.push("rollback");
      },
    });
  };
  const client = enforceTursoForeignKeys(
    unsafeCoerce<Client>({
      transaction: async (mode: string) => {
        calls.push(`transaction:${mode}`);
        return createTransaction();
      },
    }),
  );

  expect((await client.execute("select ?", [1n])).rows[0]?.[0]).toBe(1n);
  expect(applicationStatement).toEqual({ args: [1n], sql: "select ?" });
  expect(calls).toEqual([
    "transaction:deferred",
    "executeMultiple:ROLLBACK; PRAGMA foreign_keys = ON; BEGIN DEFERRED",
    "execute:PRAGMA foreign_keys",
    "execute:select ?",
    "commit",
    "close",
  ]);
});

test("Turso root reads can overlap without reserving the writer", async () => {
  let activeReads = 0;
  let maxActiveReads = 0;
  let releaseReads!: () => void;
  const readsStarted = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  const requestedModes: string[] = [];
  const setups: string[] = [];
  const client = forceTursoWriteTransactions(
    enforceTursoForeignKeys(
      unsafeCoerce<Client>({
        transaction: async (mode: string) => {
          requestedModes.push(mode);
          let foreignKeysEnabled = false;
          return unsafeCoerce<Transaction>({
            close: () => undefined,
            commit: async () => undefined,
            execute: async (statement: InStatement) => {
              const query =
                typeof statement === "string" ? statement : statement.sql;
              if (query === "PRAGMA foreign_keys") {
                return resultSet([foreignKeysEnabled ? 1n : 0n]);
              }
              activeReads += 1;
              maxActiveReads = Math.max(maxActiveReads, activeReads);
              if (activeReads === 2) {
                releaseReads();
              }
              await readsStarted;
              activeReads -= 1;
              return resultSet([1n]);
            },
            executeMultiple: async (statement: string) => {
              setups.push(statement);
              foreignKeysEnabled = statement.includes(
                "PRAGMA foreign_keys = ON",
              );
            },
            rollback: async () => undefined,
          });
        },
      }),
    ),
  );

  await Promise.all([
    client.execute("SELECT 1"),
    client.execute({ sql: "  select 2" }),
  ]);

  expect(requestedModes).toEqual(["deferred", "deferred"]);
  expect(setups).toEqual([
    "ROLLBACK; PRAGMA foreign_keys = ON; BEGIN DEFERRED",
    "ROLLBACK; PRAGMA foreign_keys = ON; BEGIN DEFERRED",
  ]);
  expect(maxActiveReads).toBe(2);
});

test("Turso root writes reserve the writer immediately", async () => {
  const calls: string[] = [];
  let foreignKeysEnabled = false;
  const client = enforceTursoForeignKeys(
    unsafeCoerce<Client>({
      transaction: async (mode: string) => {
        calls.push(`transaction:${mode}`);
        return unsafeCoerce<Transaction>({
          close: () => calls.push("close"),
          commit: async () => {
            calls.push("commit");
          },
          execute: async (statement: InStatement) => {
            const query =
              typeof statement === "string" ? statement : statement.sql;
            calls.push(`execute:${query}`);
            return query === "PRAGMA foreign_keys"
              ? resultSet([foreignKeysEnabled ? 1n : 0n])
              : resultSet([1n]);
          },
          executeMultiple: async (statement: string) => {
            calls.push(`executeMultiple:${statement}`);
            foreignKeysEnabled = statement.includes("PRAGMA foreign_keys = ON");
          },
          rollback: async () => undefined,
        });
      },
    }),
  );

  await client.execute("INSERT INTO example VALUES (1)");

  expect(calls).toEqual([
    "transaction:write",
    "executeMultiple:ROLLBACK; PRAGMA foreign_keys = ON; BEGIN IMMEDIATE",
    "execute:PRAGMA foreign_keys",
    "execute:INSERT INTO example VALUES (1)",
    "commit",
    "close",
  ]);
});

test("Turso fails closed when foreign keys cannot be enabled", async () => {
  let rolledBack = false;
  let closed = false;
  const client = enforceTursoForeignKeys(
    unsafeCoerce<Client>({
      transaction: async () =>
        unsafeCoerce<Transaction>({
          close: () => {
            closed = true;
          },
          execute: async () => resultSet([0n]),
          executeMultiple: async () => undefined,
          rollback: async () => {
            rolledBack = true;
          },
        }),
    }),
  );

  await expect(client.transaction()).rejects.toThrow(
    "Turso connection did not enable foreign key enforcement",
  );
  expect(rolledBack).toBe(true);
  expect(closed).toBe(true);
});

test("Turso preserves wide integers while normalizing safe values", async () => {
  const wide = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  const transaction = unsafeCoerce<Transaction>({
    batch: async () => [resultSet([2n, wide])],
    execute: async () => resultSet([3n, wide]),
  });
  const client = normalizeTursoResultIntegers(
    unsafeCoerce<Client>({
      batch: async () => [resultSet([1n, wide])],
      execute: async () => resultSet([1n, wide]),
      migrate: async () => [resultSet([1n, wide])],
      transaction: async () => transaction,
    }),
  );

  for (const result of [
    await client.execute("select 1"),
    ...(await client.batch(["select 1"])),
    ...(await client.migrate(["select 1"])),
  ]) {
    expect(result.rows[0]?.[0]).toBe(1);
    expect(result.rows[0]?.[1]).toBe(wide);
  }

  const wrappedTransaction = await client.transaction("write");
  const transactionResult = await wrappedTransaction.execute("select 1");
  expect(transactionResult.rows[0]?.[0]).toBe(3);
  expect(transactionResult.rows[0]?.[1]).toBe(wide);
  const [batchResult] = await wrappedTransaction.batch(["select 1"]);
  expect(batchResult?.rows[0]?.[0]).toBe(2);
  expect(batchResult?.rows[0]?.[1]).toBe(wide);
});

test("Turso database bridge shapes execute results across nested transactions", async () => {
  const calls: string[] = [];
  const createTransaction = (depth: number) => ({
    all: async () => {
      calls.push(`execute:${depth}`);
      return [{ depth }];
    },
    transaction: async (callback: (nested: unknown) => Promise<unknown>) => {
      calls.push(`transaction:${depth + 1}`);
      return callback(createTransaction(depth + 1));
    },
  });
  const rawDatabase = {
    all: async () => {
      calls.push("execute:root");
      return [{ depth: "root" }];
    },
    transaction: async (
      callback: (transaction: unknown) => Promise<unknown>,
    ) => {
      calls.push("transaction:1");
      return callback(createTransaction(1));
    },
  };
  const database = attachTursoDatabaseBridge(
    unsafeCoerce<LibSQLDatabase<ApiSchema>>(rawDatabase),
  );

  const rootResult = await database.execute(sql`select 1`);
  expect(rootResult.rows).toEqual([{ depth: "root" }]);
  await database.transaction(async (transaction) => {
    const transactionResult = await transaction.execute(sql`select 2`);
    expect(transactionResult.rows).toEqual([{ depth: 1 }]);
    await transaction.transaction(async (nested) => {
      const nestedResult = await nested.execute(sql`select 3`);
      expect(nestedResult.rows).toEqual([{ depth: 2 }]);
    });
  });

  expect(calls).toEqual([
    "execute:root",
    "transaction:1",
    "execute:1",
    "transaction:2",
    "execute:2",
  ]);
});
