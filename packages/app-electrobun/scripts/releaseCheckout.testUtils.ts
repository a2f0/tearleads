import { execFileSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const sourceRoot = resolve(import.meta.dirname, "../../..");
const scripts = "packages/app-electrobun/scripts";

// Every fixture Git call runs with no GIT_* variable, so none can reach the
// repository running these tests.
const fixtureEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

function git(cwd: string, ...args: string[]) {
  return execFileSync(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Release test",
      "-c",
      "user.email=release-test@example.invalid",
      ...args,
    ],
    {
      cwd,
      env: fixtureEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

async function write(path: string, source: string) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${source}\n`);
  await chmod(path, 0o755);
}

// Real release shells and secrets loader, a tracked label and sourced .secrets
// that record which checkout's secrets were read.
async function createCheckout(root: string, label: string) {
  for (const path of [
    `${scripts}/releaseMacos.sh`,
    `${scripts}/releaseLinux.sh`,
    `${scripts}/macosSigning.sh`,
    "scripts/lib/desktopRelease.sh",
    "scripts/uploadMacosRelease.sh",
    "terraform/scripts/cloudflareCache.sh",
    "terraform/scripts/common.sh",
    "terraform/scripts/secretsEnv.sh",
    "terraform/scripts/stripeEnv.sh",
  ])
    await cp(join(sourceRoot, path), join(root, path));
  await write(join(root, ".gitignore"), ".secrets/\nnested/");
  await write(join(root, "checkout.txt"), label);
  await write(
    join(root, ".secrets/root.env"),
    [
      `RELEASE_TEST_SECRETS=${label}`,
      "AWS_ACCESS_KEY_ID=release-test",
      "AWS_SECRET_ACCESS_KEY=release-test",
      `printf 'secrets %s\\n' ${label} >> "$RELEASE_TEST_LOG"`,
    ].join("\n"),
  );
  for (const tier of ["prod", "staging"])
    await write(join(root, `.secrets/${tier}.env`), "");
}

// Stubs outside both checkouts. Git records its directory, how many GIT_*
// variables reached it and its arguments, then runs the real Git; the first
// release steps record what they were given and stop the release.
async function createStubs(bin: string) {
  await write(
    join(bin, "git"),
    [
      "#!/bin/sh",
      `printf 'git %s %s %s\\n' "$(pwd -P)" "$(env | grep -c '^GIT_')" "$*" >> "$RELEASE_TEST_LOG"`,
      'exec "$RELEASE_TEST_GIT" "$@"',
    ].join("\n"),
  );
  await write(join(bin, "uname"), '#!/bin/sh\necho "Darwin arm64"');
  await write(
    join(bin, "security"),
    "#!/bin/sh\necho '1) hash \"Developer ID Application: Test (TEAM)\"'",
  );
  await write(
    join(bin, "bunx"),
    [
      "#!/bin/sh",
      `printf 'step bunx %s %s %s\\n' "$(git rev-parse --show-toplevel)" "$(git rev-parse HEAD)" "$RELEASE_TEST_SECRETS" >> "$RELEASE_TEST_LOG"`,
      "exit 3",
    ].join("\n"),
  );
  await write(
    join(bin, "docker"),
    [
      "#!/bin/sh",
      'case "$1" in',
      "  info) exit 0 ;;",
      `  build) printf 'step docker %s %s %s\\n' "$BUILD_GIT_SHA" "$RELEASE_TEST_SECRETS" "$(tar -xzOf - checkout.txt)" >> "$RELEASE_TEST_LOG"; exit 3 ;;`,
      "esac",
      "exit 9",
    ].join("\n"),
  );
}

export interface ReleaseCheckouts {
  readonly root: string;
  readonly checkout: string;
  readonly decoy: string;
  readonly head: string;
}

// A checkout holding the release scripts, dirty when asked, and a clean decoy
// repository with its own secrets and a committed link to the checkout's
// macOS release script. The decoy also ignores a nested copy of the scripts
// whose .git is no repository, so Git would describe the decoy there.
export async function createReleaseCheckouts(
  dirty: boolean,
): Promise<ReleaseCheckouts> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "tearleads-release-checkout-")),
  );
  const checkout = join(root, "checkout");
  const decoy = join(root, "decoy");
  for (const [path, label] of [
    [checkout, "checkout"],
    [decoy, "decoy"],
  ] as const) {
    await createCheckout(path, label);
    if (path === decoy)
      await symlink(
        join(checkout, scripts, "releaseMacos.sh"),
        join(decoy, scripts, "linkedReleaseMacos.sh"),
      );
    git(path, "init", "--quiet");
    git(path, "add", ".");
    git(path, "commit", "--quiet", "-m", "Fixture");
  }
  await createCheckout(join(decoy, "nested"), "nested");
  await mkdir(join(decoy, "nested/.git"));
  if (dirty) await write(join(checkout, "bunfig.toml"), "preload = []");
  await createStubs(join(root, "bin"));
  await write(join(root, "AuthKey_test.p8"), "test-only-key");
  await write(join(root, "ignore-all"), "*");
  await write(
    join(root, "hostile.gitconfig"),
    `[core]\n\tworktree = ${decoy}\n\texcludesFile = ${join(root, "ignore-all")}`,
  );
  return { root, checkout, decoy, head: git(checkout, "rev-parse", "HEAD") };
}

export async function removeReleaseCheckouts(checkouts?: ReleaseCheckouts) {
  if (checkouts) await rm(checkouts.root, { recursive: true, force: true });
}

// Each names Git state that would describe the decoy rather than the checkout.
export function hostileGitEnvironments({ root, decoy }: ReleaseCheckouts) {
  const gitDir = join(decoy, ".git");
  const config = join(root, "hostile.gitconfig");
  const variants: Record<string, Record<string, string>> = {
    "GIT_DIR and GIT_WORK_TREE": { GIT_DIR: gitDir, GIT_WORK_TREE: decoy },
    GIT_DIR: { GIT_DIR: gitDir },
    GIT_WORK_TREE: { GIT_WORK_TREE: decoy },
    "GIT_CEILING_DIRECTORIES and discovery": {
      GIT_CEILING_DIRECTORIES: root,
      GIT_DISCOVERY_ACROSS_FILESYSTEM: "1",
    },
    "core.worktree and excludesFile configuration": {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.worktree",
      GIT_CONFIG_VALUE_0: decoy,
      GIT_CONFIG_PARAMETERS: `'core.worktree'='${decoy}'`,
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_SYSTEM: config,
    },
    "index, object store and namespace": {
      GIT_INDEX_FILE: join(gitDir, "index"),
      GIT_OBJECT_DIRECTORY: join(gitDir, "objects"),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(gitDir, "objects"),
      GIT_COMMON_DIR: gitDir,
      GIT_NAMESPACE: "decoy",
    },
  };
  return variants;
}

// Runs a release command from inside the decoy with `hostile` set, and splits
// what it recorded into Git calls and everything else.
export async function runRelease(
  checkouts: ReleaseCheckouts,
  command: readonly string[],
  hostile: Record<string, string>,
) {
  const { root, decoy } = checkouts;
  const { PATH: inheritedPath } = process.env;
  const { PATH: fixturePath } = fixtureEnv;
  const log = join(root, `calls-${crypto.randomUUID()}.log`);
  const child = Bun.spawn([...command], {
    cwd: decoy,
    env: {
      ...hostile,
      PATH: `${join(root, "bin")}:${inheritedPath ?? ""}`,
      HOME: root,
      RELEASE_TEST_LOG: log,
      RELEASE_TEST_GIT: Bun.which("git", { PATH: fixturePath }) ?? "git",
      APP_STORE_CONNECT_KEY_ID: "test",
      APP_STORE_CONNECT_ISSUER_ID: "test-issuer",
      ELECTROBUN_APPLEAPIKEYPATH: join(root, "AuthKey_test.p8"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  const calls = (await Bun.file(log).exists())
    ? (await Bun.file(log).text()).trim().split("\n")
    : [];
  return {
    exitCode,
    stderr,
    gitCalls: calls.filter((call) => call.startsWith("git ")),
    steps: calls.filter((call) => !call.startsWith("git ")),
  };
}
