import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const library = join(import.meta.dir, "secretsStore.sh");
const { PATH = "" } = process.env;

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A workspace folder holding a clone at `clonePath`, marked as a Git checkout. */
function workspace(clonePath = "clone"): { root: string; repo: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "secrets-store-")));
  temporary.push(root);
  const repo = join(root, clonePath);
  mkdirSync(join(repo, ".git"), { recursive: true });
  return { root, repo };
}

/** Creates a project folder with a tier inside, as matrix-secrets holds it. */
function store(path: string): string {
  mkdirSync(join(path, "tearleads/prod"), { recursive: true });
  writeFileSync(join(path, "tearleads/prod/shared.env"), "MARKER=linked\n");
  return path;
}

/** Runs the library under `set -e`, as its callers are. */
function link(
  repo: string,
  env: Record<string, string> = {},
  cwd: string = repo,
) {
  const result = Bun.spawnSync({
    cwd,
    cmd: [
      "sh",
      "-c",
      `set -e\n. "${library}"\nsecrets_store_link "$1"`,
      "sh",
      repo,
    ],
    env: { PATH, ...env },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

test("a sibling clone links to matrix-secrets beside it", () => {
  const { root, repo } = workspace();
  store(join(root, "matrix-secrets"));

  expect(link(repo)).toEqual({
    exitCode: 0,
    stdout: "Linked .secrets to ../matrix-secrets/tearleads\n",
    stderr: "",
  });
  expect(readlinkSync(join(repo, ".secrets"))).toBe(
    "../matrix-secrets/tearleads",
  );
  expect(readFileSync(join(repo, ".secrets/prod/shared.env"), "utf8")).toBe(
    "MARKER=linked\n",
  );
});

test("a matrix checkout links to matrix-secrets beside the workspace", () => {
  const { root, repo } = workspace("matrix/checkouts/tearleads");
  writeFileSync(join(root, "matrix/matrix.json"), "{}\n");
  store(join(root, "matrix-secrets"));

  expect(link(repo).exitCode).toBe(0);
  expect(readlinkSync(join(repo, ".secrets"))).toBe(
    "../../../matrix-secrets/tearleads",
  );
  expect(readFileSync(join(repo, ".secrets/prod/shared.env"), "utf8")).toBe(
    "MARKER=linked\n",
  );
});

test("a checkouts folder outside a matrix workspace links beside the clone", () => {
  const { root, repo } = workspace("elsewhere/checkouts/tearleads");
  store(join(root, "elsewhere/checkouts/matrix-secrets"));

  expect(link(repo).exitCode).toBe(0);
  expect(readlinkSync(join(repo, ".secrets"))).toBe(
    "../matrix-secrets/tearleads",
  );
});

test("MATRIX_SECRETS_DIR wins and links by absolute path", () => {
  const { root, repo } = workspace();
  store(join(root, "matrix-secrets"));
  const chosen = store(join(root, "chosen"));

  const result = link(repo, { MATRIX_SECRETS_DIR: `${chosen}/` });
  expect(result.exitCode).toBe(0);
  expect(readlinkSync(join(repo, ".secrets"))).toBe(join(chosen, "tearleads"));
});

test("a relative MATRIX_SECRETS_DIR resolves against the clone, not the caller's directory", () => {
  const { root, repo } = workspace();
  const chosen = store(join(root, "chosen"));
  const elsewhere = join(repo, "packages/app-capacitor");
  mkdirSync(elsewhere, { recursive: true });

  const result = link(repo, { MATRIX_SECRETS_DIR: "../chosen" }, elsewhere);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(readlinkSync(join(repo, ".secrets"))).toBe(join(chosen, "tearleads"));
});

test("a MATRIX_SECRETS_DIR that names no folder warns and links nothing", () => {
  const { root, repo } = workspace();
  store(join(root, "matrix-secrets"));

  const result = link(repo, { MATRIX_SECRETS_DIR: join(root, "missing") });
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("so .secrets stays unlinked");
  expect(present(join(repo, ".secrets"))).toBe(false);
});

test("without the store it warns, links nothing, and never fails", () => {
  const { repo } = workspace();

  const result = link(repo);
  expect(result).toEqual({
    exitCode: 0,
    stdout: "",
    stderr:
      "warning: no matrix-secrets/tearleads folder found, so .secrets stays unlinked\n",
  });
  expect(present(join(repo, ".secrets"))).toBe(false);
});

test("a folder owned by another user is not linked", () => {
  const { root, repo } = workspace();
  store(join(root, "matrix-secrets"));
  // An `id` that reports a different user than the one owning the fixture.
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "id"),
    '#!/bin/sh\nif [ "$1" = -un ]; then echo someone; else echo 4242424; fi\n',
  );
  chmodSync(join(bin, "id"), 0o755);

  const result = link(repo, { PATH: `${bin}:${PATH}` });
  expect(result).toEqual({
    exitCode: 0,
    stdout: "",
    stderr:
      "warning: ../matrix-secrets/tearleads is not owned by someone, so .secrets stays unlinked\n",
  });
  expect(present(join(repo, ".secrets"))).toBe(false);
});

test("an existing .secrets, even a dangling link, is left alone", () => {
  const { root, repo } = workspace();
  store(join(root, "matrix-secrets"));

  symlinkSync("../nowhere", join(repo, ".secrets"));
  expect(link(repo)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  expect(readlinkSync(join(repo, ".secrets"))).toBe("../nowhere");

  rmSync(join(repo, ".secrets"));
  mkdirSync(join(repo, ".secrets"));
  expect(link(repo)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  expect(lstatSync(join(repo, ".secrets")).isDirectory()).toBe(true);
});

test("outside a Git checkout it does nothing", () => {
  const { root, repo } = workspace();
  store(join(root, "matrix-secrets"));
  rmSync(join(repo, ".git"), { recursive: true });

  expect(link(repo)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  expect(present(join(repo, ".secrets"))).toBe(false);
});
