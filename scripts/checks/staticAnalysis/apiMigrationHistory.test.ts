import { expect, test } from "bun:test";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  apiMigrationHistoryErrors,
  apiMigrationsPath,
  type MigrationFiles,
} from "../apiMigrationHistory";

import { fixture } from "./fixture.testUtils";

const repoRoot = resolve(import.meta.dir, "../../..");

test("migration checks at the checkout root compare its own Git history", () => {
  const decoy = fixture();
  try {
    decoy.commit();
    const nesting = join(
      decoy.cwd,
      process.platform === "win32" ? "inside" : "layer:inside",
    );
    mkdirSync(nesting);
    const repo = fixture(nesting);
    for (const file of [
      "scripts/lib/checkRoot.ts",
      "scripts/checks/lintApiMigrations.ts",
      "scripts/checks/apiMigrationHistory.ts",
    ])
      repo.write(file, readFileSync(join(repoRoot, file), "utf8"));
    for (const [file, content] of base)
      repo.write(join(apiMigrationsPath, file), content);
    repo.commit();
    const cwd = process.platform === "win32" ? repo.cwd : `${repo.cwd} `;
    if (cwd !== repo.cwd) renameSync(repo.cwd, cwd);
    const run = () =>
      Bun.spawnSync([process.execPath, "scripts/checks/lintApiMigrations.ts"], {
        cwd,
        env: {
          ...decoy.env,
          AGENT_TOOL_PUSH_GATE: "stale-context",
          API_MIGRATIONS_BASE_REF: "HEAD",
          GIT_DIR: join(decoy.cwd, ".git"),
          GIT_INDEX_FILE: join(decoy.cwd, ".git/index"),
          GIT_SHALLOW_FILE: join(decoy.cwd, "foreign-shallow"),
          GIT_GRAFT_FILE: join(decoy.cwd, "foreign-grafts"),
        },
      });
    const result = run();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain("API migrations append to HEAD");
    const detachedGitDir = join(decoy.cwd, "separate-git-dir");
    renameSync(join(cwd, ".git"), detachedGitDir);
    writeFileSync(join(cwd, ".git"), `gitdir: ${detachedGitDir}\n`);
    const hooked = Bun.spawnSync(
      [process.execPath, "scripts/checks/lintApiMigrations.ts"],
      {
        cwd,
        env: {
          ...decoy.env,
          AGENT_TOOL_PUSH_GATE: "fixture-context",
          API_MIGRATIONS_BASE_REF: "HEAD",
          GIT_DIR: detachedGitDir,
          GIT_WORK_TREE: cwd,
        },
      },
    );
    expect(hooked.exitCode, hooked.stderr.toString()).toBe(0);
    expect(hooked.stdout.toString()).toContain("API migrations append to HEAD");
    rmSync(join(cwd, ".git"));
    const exported = run();
    expect(exported.exitCode).toBe(1);
    expect(exported.stderr.toString()).toContain(
      "requires its own Git checkout",
    );
  } finally {
    rmSync(decoy.cwd, { recursive: true, force: true });
  }
});

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
