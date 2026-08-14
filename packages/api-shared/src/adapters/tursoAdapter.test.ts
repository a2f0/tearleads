import { expect, test } from "bun:test";
import type { Client, Transaction } from "@libsql/client/web";
import { unsafeCoerce } from "../unsafeCoerce.js";
import {
  forceTursoWriteTransactions,
  readTursoConnectionConfig,
} from "./tursoAdapter";

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
