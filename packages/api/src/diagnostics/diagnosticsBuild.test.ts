import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeSentryEvent } from "@tearleads/diagnostics/privacy";
import {
  apiBuildVersion,
  apiDiagnosticsBuildOptions,
  diagnosticsBuild,
} from "../../scripts/diagnosticsBuild";
import { resolveApiSentryConfig } from "./sentryConfig";

test("source archives build without enabling API diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "api-without-git-"));
  try {
    const build = diagnosticsBuild(directory);
    expect(build).toEqual({
      commit: "",
      sourceRoot: directory,
      sourcePaths: [],
    });
    expect(
      resolveApiSentryConfig({
        ...build,
        dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
        environment: "production",
      }),
    ).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the executable builder's trailing-slash root preserves absolute and relative API frames", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  expect(root.endsWith("/")).toBe(true);
  const build = diagnosticsBuild(root);
  expect(build.sourceRoot.endsWith("/")).toBe(false);
  expect(build.commit).toMatch(/^[a-f0-9]{40}$/u);
  expect(build.sourcePaths).toContain("/packages/api/src/index.ts");
  expect(
    build.sourcePaths.some(
      (path) => path.includes("/app/") || path.includes(".test."),
    ),
  ).toBe(false);
  const config = resolveApiSentryConfig({
    ...build,
    dsn: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
    environment: "staging",
  });
  if (!config) throw new Error("Expected API diagnostics build configuration");
  const event = sanitizeSentryEvent(
    {
      tags: { diagnostic_source: "request-error" },
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                { filename: `${root}packages/api/src/index.ts`, lineno: 10 },
                { filename: "packages/api/src/index.ts", lineno: 20 },
                { filename: "app:///packages/api/src/index.ts", lineno: 30 },
              ],
            },
          },
        ],
      },
    },
    config,
  );
  expect(event?.exception?.values?.[0]?.stacktrace?.frames).toEqual(
    [10, 20, 30].map((lineno) => ({
      filename: "app:///packages/api/src/index.ts",
      lineno,
      in_app: true,
    })),
  );
  expect(JSON.stringify(event)).not.toContain(root);
});

// CI checks out shallow history, which builds without a version, so version
// tests count commits in a repository they create rather than in this one.
function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(
    [
      "git",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Build Test",
      "-c",
      "user.email=build@example.test",
      ...args,
    ],
    { cwd, stdout: "ignore", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function createRepository(path: string, commits: number): string {
  git(tmpdir(), "init", "--quiet", path);
  for (let commit = 1; commit <= commits; commit += 1) {
    git(path, "commit", "--quiet", "--allow-empty", "-m", `commit ${commit}`);
  }
  return path;
}

test("the build version is HEAD's commit count, absent without full history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "api-build-version-"));
  try {
    expect(apiBuildVersion(directory)).toBeNull();

    const source = createRepository(join(directory, "source"), 2);
    expect(apiBuildVersion(source)).toBe(2);

    const shallow = join(directory, "shallow");
    git(
      directory,
      "clone",
      "--quiet",
      "--depth",
      "1",
      `file://${source}`,
      shallow,
    );
    expect(apiBuildVersion(shallow)).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the executable builder stamps its version into the API runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "api-version-build-"));
  try {
    const root = createRepository(join(directory, "source"), 3);
    const fixture = join(directory, "fixture.ts");
    await Bun.write(
      fixture,
      `import { readApiBuildVersion } from ${JSON.stringify(join(import.meta.dirname, "apiVersion.ts"))};
console.log(JSON.stringify(readApiBuildVersion()));`,
    );
    const result = await Bun.build({
      entrypoints: [fixture],
      outdir: directory,
      target: "bun",
      define: apiDiagnosticsBuildOptions(root).define,
    });
    expect(result.success).toBe(true);
    const run = Bun.spawnSync([
      process.execPath,
      join(directory, "fixture.js"),
    ]);
    expect(JSON.parse(run.stdout.toString())).toBe(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
