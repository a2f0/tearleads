import { expect, test } from "bun:test";
import { readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./softReset.testUtils";
import { readResetSchema } from "./softResetSchema";

test("reset preflight accepts the shipped migration layout", () => {
  const root = resolve(import.meta.dir, "../../..");
  const files = readdirSync(join(root, "packages/api-shared/drizzle"));
  const schema = readResetSchema(root);
  expect(schema.migrations).toHaveLength(
    files.filter((file) => file.endsWith(".sql")).length,
  );
  expect(schema.names).toContain("users");
});

test("reset preflight rejects SQL outside the migration journal", () => {
  const f = fixture();
  try {
    f.write("packages/api-shared/drizzle/0002_unregistered.sql", "SELECT 1;");
    expect(() => readResetSchema(f.repo)).toThrow(
      "missing from the reset migration journal",
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test.each([
  { idx: 0, tag: "0001_rename_users", when: 2000 },
  { idx: 1, tag: "0001_rename_users", when: 1000 },
  { idx: 1, tag: "0001_missing_sql", when: 2000 },
  { idx: 1, tag: 1, when: 2000 },
  { idx: 1, tag: "0001_rename_users", when: 2000.5 },
  { idx: 1, tag: "0000_greenfield_baseline", when: 2000 },
])("rejects an invalid second journal entry %j", (entry) => {
  const f = fixture();
  try {
    f.write(
      "packages/api-shared/drizzle/meta/_journal.json",
      JSON.stringify({
        entries: [
          { idx: 0, tag: "0000_greenfield_baseline", when: 1000 },
          entry,
        ],
      }),
    );
    expect(() => readResetSchema(f.repo)).toThrow(
      "Invalid reset migration journal entry at index 1",
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test.each([
  ["archive", "users"],
  ["public", "invalid-name"],
])("rejects unsupported snapshot table %s.%s", (schema, name) => {
  const f = fixture();
  try {
    f.write(
      "packages/api-shared/drizzle/meta/0001_snapshot.json",
      JSON.stringify({
        tables: {
          [`${schema}.${name}`]: { schema, name },
        },
      }),
    );
    expect(() => readResetSchema(f.repo)).toThrow("Unsupported table");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test.each([
  [
    "_journal.json",
    { entries: [] },
    "Empty or malformed reset migration journal",
  ],
  [
    "_journal.json",
    { entries: {} },
    "Empty or malformed reset migration journal",
  ],
  ["0001_snapshot.json", { tables: {} }, "No application tables"],
] as const)("rejects %s containing %j", (file, contents, error) => {
  const f = fixture();
  try {
    f.write(
      `packages/api-shared/drizzle/meta/${file}`,
      JSON.stringify(contents),
    );
    expect(() => readResetSchema(f.repo)).toThrow(error);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
