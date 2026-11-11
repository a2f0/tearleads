import { expect, test } from "bun:test";
import { readApiDatabaseKind } from "./dialect";

test("API_DATABASE accepts only Postgres backends", () => {
  expect(readApiDatabaseKind({ API_DATABASE: " PGlite " })).toBe("memory");
  expect(readApiDatabaseKind({ API_DATABASE: "postgres" })).toBe("postgres");
  for (const value of ["sqlite", "turso"]) {
    expect(() => readApiDatabaseKind({ API_DATABASE: value })).toThrow(
      `Unsupported API_DATABASE value: ${value}`,
    );
  }
});
