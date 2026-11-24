import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// load_secrets_env, which every deploy, destroy, Terraform, soft-reset, and
// desktop-release script calls, links a fresh clone's .secrets before reading
// it, and refuses to continue without the tier folder instead of warning and
// failing later on a missing variable.

const repositoryRoot = join(import.meta.dir, "../..");
const { PATH = "" } = process.env;
const loaderFiles = [
  "terraform/scripts/common.sh",
  "terraform/scripts/secretsEnv.sh",
  "terraform/scripts/stripeEnv.sh",
  "terraform/scripts/cloudflareCache.sh",
  "scripts/lib/secretsStore.sh",
];

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A fresh clone holding the real loader, beside an optional secrets store. */
function workspace(withStore: boolean) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "secrets-loader-")));
  temporary.push(root);
  const repo = join(root, "clone");
  mkdirSync(join(repo, ".git"), { recursive: true });
  for (const path of loaderFiles) {
    cpSync(join(repositoryRoot, path), join(repo, path));
  }
  if (withStore) {
    const store = join(root, "matrix-secrets");
    for (const tier of ["prod", "staging"]) {
      mkdirSync(join(store, "tearleads", tier), { recursive: true });
      writeFileSync(
        join(store, "tearleads", tier, "shared.env"),
        `LOADER_SHARED=${tier}-shared\n`,
      );
      writeFileSync(
        join(store, "tearleads", tier, "app.env"),
        `LOADER_APP=${tier}-app\n`,
      );
    }
    chmodSync(store, 0o700);
    chmodSync(join(store, "tearleads"), 0o700);
  }
  return { root, repo };
}

/** Sources the clone's common.sh and loads `tier`, as deployment scripts do. */
function load(repo: string, tier: string) {
  const result = Bun.spawnSync({
    cwd: repo,
    cmd: [
      "bash",
      "-c",
      [
        "set -euo pipefail",
        'source "$1/terraform/scripts/common.sh"',
        'load_secrets_env "$2"',
        `printf "%s|%s\\n" "\${LOADER_SHARED:-}" "\${LOADER_APP:-}"`,
      ].join("\n"),
      "bash",
      repo,
      tier,
    ],
    env: { PATH },
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

test("a fresh clone links its store and loads the tier, keeping stdout clean", () => {
  const { repo } = workspace(true);

  const result = load(repo, "staging");

  expect(result.exitCode, result.stderr).toBe(0);
  // Callers such as the soft reset's Hyperdrive lookup capture stdout.
  expect(result.stdout).toBe("staging-shared|staging-app\n");
  expect(result.stderr).toBe(
    "Linked .secrets to ../matrix-secrets/tearleads\n",
  );
  expect(readlinkSync(join(repo, ".secrets"))).toBe(
    "../matrix-secrets/tearleads",
  );
});

test("a clone already linked loads silently", () => {
  const { repo } = workspace(true);
  expect(load(repo, "prod").exitCode).toBe(0);

  expect(load(repo, "prod")).toEqual({
    exitCode: 0,
    stdout: "prod-shared|prod-app\n",
    stderr: "",
  });
});

for (const tier of ["prod", ""]) {
  test(`without a store, loading ${tier || "no tier"} fails naming the missing prod folder`, () => {
    const { repo } = workspace(false);

    const result = load(repo, tier);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      [
        "warning: no matrix-secrets/tearleads folder found, so .secrets stays unlinked",
        `ERROR: ${repo}/.secrets/prod is missing, so no prod secrets load. A clone's .secrets links to matrix-secrets/tearleads; see docs/developer/infrastructure.md.`,
        "",
      ].join("\n"),
    );
    expect(present(join(repo, ".secrets"))).toBe(false);
  });
}

test("an existing .secrets without the tier folder fails instead of warning", () => {
  const { repo } = workspace(true);
  mkdirSync(join(repo, ".secrets/staging"), { recursive: true });

  const result = load(repo, "prod");

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    `ERROR: ${repo}/.secrets/prod is missing, so no prod secrets load. A clone's .secrets links to matrix-secrets/tearleads; see docs/developer/infrastructure.md.\n`,
  );
  // The clone's own folder is never replaced by a link.
  expect(lstatSync(join(repo, ".secrets")).isDirectory()).toBe(true);
});

test("an unknown tier is rejected before anything is linked", () => {
  const { repo } = workspace(true);

  expect(load(repo, "qa")).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "ERROR: Unknown deployment tier: qa\n",
  });
  expect(present(join(repo, ".secrets"))).toBe(false);
});
