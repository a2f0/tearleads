import { afterEach, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostedSentryEndpoint } from "./sentryCliUpload";
import { minimalSourceMap } from "./sentryStagedMaps.testUtils";
import { runDesktopSentryRelease } from "./withSentryReleaseEnv";

const { PATH: inheritedPath } = process.env;
const commit = "b".repeat(40);
const dsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`;
const sourceMaps = join(import.meta.dirname, "sentrySourceMaps.ts");
const staged = [
  "bun/index.js",
  "bun/index.js.map",
  "chunk-a1.js",
  "chunk-a1.js.map",
];

// Stands in for Electrobun and its postBuild hook: writes the app with maps
// beside its scripts, copies each pair to staging under the dist of Hutch's
// linux-x64 target, then sweeps the build directory. "partial" stages one pair;
// "foreign" stages under another tier's dist; "fail" exits after writing the app.
const hookScript = `import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hutchSourceMapIdentity, sweepSourceMaps } from ${JSON.stringify(sourceMaps)};
const { TEARLEADS_ELECTROBUN_SOURCEMAP_DIR: staging, HOOK_MODE: mode, HOOK_BUILD: build } = process.env;
await mkdir(build, { recursive: true });
await writeFile(join(build, "..", "env.json"), JSON.stringify(process.env));
for (const file of ${JSON.stringify(staged)}) {
  await mkdir(dirname(join(build, file)), { recursive: true });
  await writeFile(join(build, file), file.endsWith(".map") ? ${JSON.stringify(minimalSourceMap)} : file);
}
if (mode === "fail") process.exit(5);
if (staging) {
  const { dist } = hutchSourceMapIdentity({ ...process.env, ELECTROBUN_OS: "linux", ELECTROBUN_ARCH: "x64" });
  const target = join(staging, mode === "foreign" ? dist.replace("staging", "production") : dist);
  for (const file of mode === "partial" ? ${JSON.stringify(staged.slice(0, 2))} : ${JSON.stringify(staged)}) {
    await mkdir(dirname(join(target, file)), { recursive: true });
    await copyFile(join(build, file), join(target, file));
  }
}
await sweepSourceMaps(build);
`;

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function fixture(options: { checkout?: boolean; secrets?: boolean }) {
  root = await mkdtemp(join(tmpdir(), "deferred-sourcemaps-"));
  const repoRoot = join(root, "repo");
  const packageRoot = join(repoRoot, "packages/app");
  await mkdir(packageRoot, { recursive: true });
  await Bun.write(join(root, "hook.ts"), hookScript);
  if (options.secrets)
    await Bun.write(join(repoRoot, ".secrets/root.env"), "SYNTHETIC=1\n");
  if (options.checkout) {
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "commit.gpgsign=false",
          "-c",
          "user.name=T",
          "-c",
          "user.email=t@example.invalid",
          ...args,
        ],
        { cwd: repoRoot, stdio: "ignore" },
      );
    await Bun.write(join(repoRoot, ".gitignore"), "build/\n");
    git("init", "--quiet");
    git("add", ".");
    git("commit", "--quiet", "-m", "Fixture");
  }
  const build = join(packageRoot, "build/app");
  return { repoRoot, packageRoot, build };
}

function release(
  paths: { repoRoot: string; packageRoot: string; build: string },
  env: Record<string, string | undefined>,
) {
  return runDesktopSentryRelease({
    ...paths,
    command: [process.execPath, join(root, "hook.ts")],
    env: { PATH: inheritedPath, HOOK_BUILD: paths.build, ...env },
    endpoint: hostedSentryEndpoint,
  });
}

const deferred = {
  ELECTROBUN_RELEASE_TIER: "staging",
  TEARLEADS_ELECTROBUN_SOURCEMAP_UPLOAD: "deferred",
  BUILD_GIT_SHA: commit,
  SENTRY_ELECTROBUN_STAGING_DSN: dsn,
};

function stagedFiles(packageRoot: string) {
  const dir = join(packageRoot, "build/sentry-sourcemaps");
  return existsSync(dir)
    ? [...new Bun.Glob("**/*").scanSync({ cwd: dir })].sort()
    : [];
}

test("the Linux container's deferred build stages and sweeps its maps but runs nothing besides the build", async () => {
  const paths = await fixture({});
  const spawn = spyOn(Bun, "spawn");
  try {
    expect(
      await release(paths, {
        ...deferred,
        SENTRY_ELECTROBUN_STAGING_PROJECT: "x",
        SENTRY_URL: "http://127.0.0.1:9/",
      }),
    ).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
  } finally {
    spawn.mockRestore();
  }
  expect(stagedFiles(paths.packageRoot)).toEqual(
    staged.map((file) => `staging-app-linux-x64/${file}`),
  );
  expect([...new Bun.Glob("**/*.map").scanSync({ cwd: paths.build })]).toEqual(
    [],
  );
  const env = await Bun.file(join(paths.packageRoot, "build/env.json")).json();
  expect(env.BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT).toBe(commit);
  expect(env.BUN_PUBLIC_SENTRY_ELECTROBUN_DSN).toBe(dsn);
  expect(
    Object.keys(env).filter((name: string) => name.startsWith("SENTRY_")),
  ).toEqual([]);
});

test.each([
  ["a checkout", { checkout: true }, deferred, /Only a source archive/],
  [
    "an upload token",
    {},
    { ...deferred, SENTRY_AUTH_TOKEN: "t" },
    /must not hold upload credentials/,
  ],
  [".secrets", { secrets: true }, deferred, /must not hold upload credentials/],
  [
    "no BUILD_GIT_SHA",
    {},
    { ...deferred, BUILD_GIT_SHA: undefined },
    /requires BUILD_GIT_SHA/,
  ],
  [
    "a short BUILD_GIT_SHA",
    {},
    { ...deferred, BUILD_GIT_SHA: "abc1234" },
    /full commit/,
  ],
  [
    "an unknown upload mode",
    {},
    { ...deferred, TEARLEADS_ELECTROBUN_SOURCEMAP_UPLOAD: "skip" },
    /must be unset or deferred/,
  ],
  [
    "no deferral in a source archive",
    {},
    { ...deferred, TEARLEADS_ELECTROBUN_SOURCEMAP_UPLOAD: undefined },
    /from a clean Git checkout/,
  ],
  [
    "no deferral or upload credentials in a checkout",
    { checkout: true },
    { ...deferred, TEARLEADS_ELECTROBUN_SOURCEMAP_UPLOAD: undefined },
    /SENTRY_AUTH_TOKEN/,
  ],
] as const)(
  "a release tier with %s stops before building",
  async (_name, shape, env, message) => {
    const paths = await fixture(shape);
    await expect(release(paths, env)).rejects.toThrow(message);
    expect(existsSync(join(paths.packageRoot, "build/env.json"))).toBe(false);
  },
);

test("an unset tier ignores the deferral and stages nothing", async () => {
  const paths = await fixture({});
  expect(
    await release(paths, { TEARLEADS_ELECTROBUN_SOURCEMAP_UPLOAD: "deferred" }),
  ).toBe(0);
  const env = await Bun.file(join(paths.packageRoot, "build/env.json")).json();
  expect(env.TEARLEADS_ELECTROBUN_SOURCEMAP_DIR).toBeUndefined();
  expect(stagedFiles(paths.packageRoot)).toEqual([]);
});

test("a failed, partially staged or foreign-dist deferred build removes staging and fails", async () => {
  const failed = await fixture({});
  expect(await release(failed, { ...deferred, HOOK_MODE: "fail" })).toBe(5);
  expect(stagedFiles(failed.packageRoot)).toEqual([]);
  await rm(root, { recursive: true, force: true });
  const partial = await fixture({});
  await expect(
    release(partial, { ...deferred, HOOK_MODE: "partial" }),
  ).rejects.toThrow(/Unexpected desktop source-map staging contents/);
  expect(stagedFiles(partial.packageRoot)).toEqual([]);
  await rm(root, { recursive: true, force: true });
  const foreign = await fixture({});
  await expect(
    release(foreign, { ...deferred, HOOK_MODE: "foreign" }),
  ).rejects.toThrow(/expected staging-app-/);
  expect(stagedFiles(foreign.packageRoot)).toEqual([]);
});
