import { afterEach } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repositories: string[] = [];

// Nested repositories must not inherit the enclosing hook's Git checkout.
export const fixtureGitEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

// Explicit identity: CI runners have none, and git merge refuses to start
// without one.
const GIT_CONFIG = [
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.com",
];

export function git(rootDir: string, args: string[]): string {
  return execFileSync("git", [...GIT_CONFIG, ...args], {
    cwd: rootDir,
    env: fixtureGitEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Merge `main` into the checkout, returning git's exit status. */
export function mergeMain(rootDir: string): number | null {
  return spawnSync("git", [...GIT_CONFIG, "merge", "--no-edit", "main"], {
    cwd: rootDir,
    env: fixtureGitEnv,
    stdio: "ignore",
  }).status;
}

export function manifest(name: string, version: string, extra = ""): string {
  return `{
  "name": "${name}",
  "version": "${version}",
  "private": true,${extra}
  "type": "module"
}
`;
}

export function write(rootDir: string, file: string, source: string): void {
  const target = path.join(rootDir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}

export function read(rootDir: string, file: string): string {
  return readFileSync(path.join(rootDir, file), "utf8");
}

export function commitAll(rootDir: string, message: string): string {
  git(rootDir, ["add", "-A"]);
  git(rootDir, ["commit", "-q", "-m", message]);
  return git(rootDir, ["rev-parse", "HEAD"]);
}

export const FRONTEND = "packages/windowing/package.json";
export const BACKEND = "packages/agent-tool/package.json";

/** A repo on `main` with both versioned packages, checked out on `feature`. */
export function repository(): string {
  const rootDir = mkdtempSync(path.join(tmpdir(), "agent-tool-versions-"));
  repositories.push(rootDir);
  git(rootDir, ["init", "-q", "-b", "main"]);
  write(
    rootDir,
    "package.json",
    JSON.stringify({ workspaces: ["packages/*"] }),
  );
  write(rootDir, FRONTEND, manifest("frontend", "0.7.101"));
  write(rootDir, "packages/windowing/src/app.ts", "export {};\n");
  write(rootDir, BACKEND, manifest("backend", "0.2.0"));
  write(rootDir, "packages/agent-tool/src/app.ts", "export {};\n");
  write(rootDir, "README.md", "demo\n");
  commitAll(rootDir, "chore: initial");
  git(rootDir, ["checkout", "-q", "-b", "feature"]);
  return rootDir;
}

/** Commit on `main` without leaving `feature`, returning the new main OID. */
export function commitOnMain(
  rootDir: string,
  files: Record<string, string>,
): string {
  git(rootDir, ["checkout", "-q", "main"]);
  for (const [file, source] of Object.entries(files)) {
    write(rootDir, file, source);
  }
  const oid = commitAll(rootDir, "chore: main moves");
  git(rootDir, ["checkout", "-q", "feature"]);
  return oid;
}

export function mainOid(rootDir: string): string {
  return git(rootDir, ["rev-parse", "main"]);
}

afterEach(() => {
  for (const rootDir of repositories.splice(0)) {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
