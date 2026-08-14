import { expect, test } from "bun:test";
import { isSqliteSchemaDialect, readApiDatabaseKind } from "./dialect";

test("Turso selects the SQLite schema dialect", () => {
  const env = { API_DATABASE: " turso " };
  expect(readApiDatabaseKind(env)).toBe("turso");
  expect(isSqliteSchemaDialect(env)).toBe(true);
});
