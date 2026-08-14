import { expect, test } from "bun:test";
import {
  embeddedMigrationPath,
  migrationAssetPatterns,
  migrationDialectForDatabase,
} from "./migrationAssets";

test("migration assets include both API database dialects", () => {
  expect(migrationAssetPatterns).toEqual([
    "packages/api-shared/drizzle/**/*.sql",
    "packages/api-shared/drizzle/**/*.json",
    "packages/api-shared/drizzle-sqlite/**/*.sql",
    "packages/api-shared/drizzle-sqlite/**/*.json",
  ]);
});

test("embedded migrations are selected only from the active dialect", () => {
  const postgresName =
    "/build/packages/api-shared/drizzle/0000_greenfield_baseline.sql";
  const sqliteName =
    "/build/packages/api-shared/drizzle-sqlite/0000_greenfield_baseline.sql";

  expect(embeddedMigrationPath(postgresName, "postgres")).toBe(
    "0000_greenfield_baseline.sql",
  );
  expect(embeddedMigrationPath(sqliteName, "sqlite")).toBe(
    "0000_greenfield_baseline.sql",
  );
  expect(embeddedMigrationPath(sqliteName, "postgres")).toBeUndefined();
  expect(embeddedMigrationPath(postgresName, "sqlite")).toBeUndefined();
  expect(
    embeddedMigrationPath(
      "/build/drizzle/not-an-api-migration.sql",
      "postgres",
    ),
  ).toBeUndefined();
});

test("SQLite and Turso select the SQLite migration bundle", () => {
  expect(migrationDialectForDatabase("sqlite")).toBe("sqlite");
  expect(migrationDialectForDatabase(" SQLITE ")).toBe("sqlite");
  expect(migrationDialectForDatabase("turso")).toBe("sqlite");
  expect(migrationDialectForDatabase(" TURSO ")).toBe("sqlite");
  expect(migrationDialectForDatabase("postgres")).toBe("postgres");
  expect(migrationDialectForDatabase("pglite")).toBe("postgres");
  expect(migrationDialectForDatabase(undefined)).toBe("postgres");
});
