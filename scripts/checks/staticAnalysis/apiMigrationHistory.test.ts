import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  apiMigrationHistoryErrors,
  apiMigrationsPath,
  type MigrationFiles,
} from "../apiMigrationHistory";

const repoRoot = resolve(import.meta.dir, "../../..");

function readRepositoryMigrations(): Map<string, string> {
  const folder = join(repoRoot, apiMigrationsPath);
  const files = new Map<string, string>();
  for (const entry of readdirSync(folder, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(folder, path), readFileSync(path, "utf8"));
  }
  return files;
}

interface Entry {
  idx: number;
  tag: string;
  when: number;
}

function journal(entries: readonly Entry[]): string {
  return JSON.stringify({
    dialect: "postgresql",
    entries: entries.map((entry) => ({
      ...entry,
      breakpoints: true,
      version: "7",
    })),
    version: "7",
  });
}

const baseline = { idx: 0, tag: "0000_baseline", when: 100 };
const base: MigrationFiles = new Map([
  ["0000_baseline.sql", "CREATE TABLE a (id text);"],
  ["meta/0000_snapshot.json", "{}"],
  ["meta/_journal.json", journal([baseline])],
]);

function withAppended(entry: Entry, sql = "ALTER TABLE a ADD b text;") {
  return new Map([
    ...base,
    [`${entry.tag}.sql`, sql],
    [`meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`, "{}"],
    ["meta/_journal.json", journal([baseline, entry])],
  ]);
}

test("the repository's migrations append to themselves", () => {
  const files = readRepositoryMigrations();
  expect(apiMigrationHistoryErrors(files, files)).toEqual([]);
});

test("appending a migration that sorts last passes", () => {
  expect(
    apiMigrationHistoryErrors(
      base,
      withAppended({ idx: 1, tag: "0001_add_b", when: 200 }),
    ),
  ).toEqual([]);
});

test("editing or removing a shipped migration fails", () => {
  const edited = new Map(base);
  edited.set("0000_baseline.sql", "CREATE TABLE a (id text, b text);");
  expect(apiMigrationHistoryErrors(base, edited)).toEqual([
    "0000_baseline.sql was edited; add a new migration instead",
  ]);
  const removed = new Map(base);
  removed.delete("meta/0000_snapshot.json");
  expect(apiMigrationHistoryErrors(base, removed)).toEqual([
    "meta/0000_snapshot.json was removed; shipped migrations are permanent",
  ]);
});

test("rewriting a shipped journal entry fails", () => {
  const rewritten = new Map(base);
  rewritten.set(
    "meta/_journal.json",
    journal([{ ...baseline, when: baseline.when + 1 }]),
  );
  expect(apiMigrationHistoryErrors(base, rewritten)).toEqual([
    "journal entry 0 (0000_baseline) changed; shipped journal entries are permanent",
  ]);
});

test("an appended migration that sorts before the base's newest fails", () => {
  expect(
    apiMigrationHistoryErrors(
      base,
      withAppended({ idx: 1, tag: "0001_add_b", when: 50 }),
    ),
  ).toEqual([
    "0001_add_b sorts before 0000_baseline; delete it and generate it again after merging the base branch",
  ]);
});

test("an appended journal entry needs its SQL and snapshot", () => {
  const head = new Map(base);
  head.set(
    "meta/_journal.json",
    journal([baseline, { idx: 1, tag: "0001_add_b", when: 200 }]),
  );
  expect(apiMigrationHistoryErrors(base, head)).toEqual([
    "0001_add_b.sql is missing",
    "meta/0001_snapshot.json for 0001_add_b is missing",
  ]);
});
