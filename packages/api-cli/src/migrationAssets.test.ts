import { expect, test } from "bun:test";
import {
  embeddedMigrationPath,
  migrationAssetPatterns,
} from "./migrationAssets";

test("migration assets embed the Postgres baseline", () => {
  expect(migrationAssetPatterns).toEqual([
    "packages/api-shared/drizzle/**/*.sql",
    "packages/api-shared/drizzle/**/*.json",
  ]);
});

test("embedded migrations are selected only from the API baseline", () => {
  expect(
    embeddedMigrationPath(
      "/build/packages/api-shared/drizzle/0000_greenfield_baseline.sql",
    ),
  ).toBe("0000_greenfield_baseline.sql");
  expect(
    embeddedMigrationPath(
      "/build/packages/api-shared/drizzle/meta/_journal.json",
    ),
  ).toBe("meta/_journal.json");
  expect(
    embeddedMigrationPath("/build/drizzle/not-an-api-migration.sql"),
  ).toBeUndefined();
});
