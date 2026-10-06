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

test("the build version is HEAD's commit count", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const count = Bun.spawnSync(["git", "rev-list", "--count", "HEAD"], {
    cwd: root,
  });
  expect(apiBuildVersion(root)).toBe(Number(count.stdout.toString().trim()));
});

test("source archives and shallow clones build without a version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "api-build-version-"));
  const git = (...args: string[]) => {
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
      { cwd: directory, stdout: "ignore", stderr: "pipe" },
    );
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  };
  try {
    expect(apiBuildVersion(directory)).toBeNull();

    const source = join(directory, "source");
    git("init", "--quiet", source);
    for (const message of ["first", "second"]) {
      git("-C", source, "commit", "--quiet", "--allow-empty", "-m", message);
    }
    expect(apiBuildVersion(source)).toBe(2);

    const shallow = join(directory, "shallow");
    git("clone", "--quiet", "--depth", "1", `file://${source}`, shallow);
    expect(apiBuildVersion(shallow)).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the executable builder stamps its version into the API runtime", async () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), "api-version-build-"));
  try {
    const fixture = join(directory, "fixture.ts");
    await Bun.write(
      fixture,
      `import { readApiBuildVersion } from ${JSON.stringify(join(import.meta.dirname, "apiVersion.ts"))};
console.log(JSON.stringify(readApiBuildVersion()));`,
    );
    const { define } = apiDiagnosticsBuildOptions(root);
    const result = await Bun.build({
      entrypoints: [fixture],
      outdir: directory,
      target: "bun",
      define,
    });
    expect(result.success).toBe(true);
    const run = Bun.spawnSync([
      process.execPath,
      join(directory, "fixture.js"),
    ]);
    expect(JSON.parse(run.stdout.toString())).toBe(apiBuildVersion(root));
    expect(apiBuildVersion(root)).toBeGreaterThan(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
