import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  apiMigrationHistoryErrors,
  apiMigrationsPath,
  type MigrationFiles,
} from "./apiMigrationHistory";

function fail(message: string): never {
  console.error(`error api-migrations: ${message}`);
  process.exit(1);
}

function git(args: readonly string[]): string | null {
  const result = Bun.spawnSync(["git", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  return result.exitCode === 0 ? result.stdout.toString() : null;
}

function resolveCommit(ref: string): string {
  return (
    git(["rev-parse", "--verify", `${ref}^{commit}`])?.trim() ??
    fail(
      `cannot resolve the migration base '${ref}'. Fetch it or set API_MIGRATIONS_BASE_REF to a local commit.`,
    )
  );
}

// Same base as the OpenAPI compatibility check: an explicit ref, the pull
// request's base branch, or the merge base with origin/main.
function resolveBase(): { readonly commit: string; readonly label: string } {
  const {
    API_MIGRATIONS_BASE_REF: migrationsBase,
    GITHUB_BASE_REF: pullRequestBase,
    OPENAPI_BASE_REF: openApiBase,
  } = process.env;
  const explicit = migrationsBase || openApiBase;
  if (explicit) return { commit: resolveCommit(explicit), label: explicit };
  if (pullRequestBase) {
    const label = `origin/${pullRequestBase}`;
    return { commit: resolveCommit(label), label };
  }
  const tip = resolveCommit("origin/main");
  const commit =
    git(["merge-base", "HEAD", tip])?.trim() ??
    fail("cannot find a merge base between HEAD and origin/main.");
  return { commit, label: "origin/main" };
}

function readBaseFiles(commit: string): MigrationFiles {
  const files = new Map<string, string>();
  const listing = git([
    "ls-tree",
    "-r",
    "--name-only",
    commit,
    "--",
    apiMigrationsPath,
  ]);
  for (const path of listing?.split("\n").filter(Boolean) ?? []) {
    const content =
      git(["show", `${commit}:${path}`]) ?? fail(`cannot read ${path}`);
    files.set(relative(apiMigrationsPath, path), content);
  }
  return files;
}

function readWorktreeFiles(): MigrationFiles {
  const files = new Map<string, string>();
  for (const entry of readdirSync(apiMigrationsPath, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(apiMigrationsPath, path), readFileSync(path, "utf8"));
  }
  return files;
}

const base = resolveBase();
const baseFiles = readBaseFiles(base.commit);
if (baseFiles.size === 0) {
  console.log(`No API migrations at ${base.label}; nothing to compare.`);
  process.exit(0);
}
const errors = apiMigrationHistoryErrors(baseFiles, readWorktreeFiles());
if (errors.length > 0) {
  fail(
    [
      `${apiMigrationsPath} must only append to ${base.label} (${base.commit}):`,
      ...errors.map((error) => `  ${error}`),
    ].join("\n"),
  );
}
console.log(
  `API migrations append to ${base.label} (${base.commit.slice(0, 12)}).`,
);
