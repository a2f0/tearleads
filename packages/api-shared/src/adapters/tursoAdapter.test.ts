import { expect, test } from "bun:test";
import type { Client, ResultSet, Row, Transaction } from "@libsql/client/ws";
import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { unsafeCoerce } from "../unsafeCoerce.js";
import {
  attachTursoDatabaseBridge,
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
    }),
  ).toThrow("TURSO_AUTH_TOKEN is required when API_DATABASE=turso");
});

test("Turso connection config trims remote credentials", () => {
  expect(
    readTursoConnectionConfig({
      TURSO_AUTH_TOKEN: " test-token ",
      TURSO_DATABASE_URL: " libsql://test-database.turso.io ",
    }),
  ).toEqual({
    authToken: "test-token",
    intMode: "bigint",
    url: "libsql://test-database.turso.io",
  });
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
