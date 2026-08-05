import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const buildNumbersScript = resolve(
  import.meta.dir,
  "../../../scripts/getCurrentAppStoreBuildNumbers.sh",
);

interface StubbedRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly bunCalls: readonly string[];
}

async function runWithStubbedBun(
  scriptArguments: readonly string[],
  options: {
    readonly environment?: Readonly<Record<string, string>>;
    readonly stubBody?: string;
  } = {},
): Promise<StubbedRun> {
  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), "tearleads-app-store-build-numbers-"),
  );
  const bunStub = resolve(temporaryDirectory, "bun");
  const logPath = resolve(temporaryDirectory, "bun-calls.log");
  const stubBody =
    options.stubBody ??
    "printf 'Apple App Store latest build number: 42 (version 1.0)\\n'";
  await Bun.write(
    bunStub,
    [
      "#!/bin/sh",
      'printf \'%s\\n\' "$*" >> "$APP_STORE_BUILD_NUMBERS_TEST_LOG"',
      stubBody,
    ].join("\n"),
  );
  await chmod(bunStub, 0o755);

  try {
    const child = Bun.spawn([buildNumbersScript, ...scriptArguments], {
      env: {
        ...process.env,
        APP_STORE_LIVE: "",
        APP_STORE_BUILD_NUMBERS_TEST_LOG: logPath,
        PATH: `${temporaryDirectory}:${process.env.PATH ?? ""}`,
        ...options.environment,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const log = await readFile(logPath, "utf8").catch(() => "");
    const bunCalls = log.split("\n").filter((line) => line.length > 0);
    return { exitCode, stdout, stderr, bunCalls };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test("queries production then staging by default", async () => {
  const run = await runWithStubbedBun([]);

  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.bunCalls).toEqual([
    "run store:build-numbers skip_google:true apple_live:false",
    "run store:build-numbers:staging skip_google:true apple_live:false",
  ]);
});

test("a tier argument selects a single app", async () => {
  const run = await runWithStubbedBun(["staging"]);

  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.bunCalls).toEqual([
    "run store:build-numbers:staging skip_google:true apple_live:false",
  ]);
});

test("forwards extra fastlane options to the lane", async () => {
  const run = await runWithStubbedBun(["production", "apple_version:1.2"]);

  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.bunCalls).toEqual([
    "run store:build-numbers skip_google:true apple_version:1.2 apple_live:false",
  ]);
});

test("an explicit apple_live option suppresses the default", async () => {
  const run = await runWithStubbedBun(["production", "apple_live:true"]);

  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.bunCalls).toEqual([
    "run store:build-numbers skip_google:true apple_live:true",
  ]);
});

test("an exported APP_STORE_LIVE suppresses the default", async () => {
  const run = await runWithStubbedBun(["production"], {
    environment: { APP_STORE_LIVE: "true" },
  });

  expect(run.exitCode, run.stderr).toBe(0);
  expect(run.bunCalls).toEqual(["run store:build-numbers skip_google:true"]);
});

test("fails when the lane reports no App Store build number", async () => {
  const run = await runWithStubbedBun([], {
    stubBody: "printf 'Failed to fetch Apple App Store build number: nope\\n'",
  });

  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain(
    "the production fetch did not report an App Store build number",
  );
  expect(run.bunCalls).toEqual([
    "run store:build-numbers skip_google:true apple_live:false",
  ]);
});

test("propagates a failing lane exit code and stops", async () => {
  const run = await runWithStubbedBun([], { stubBody: "exit 3" });

  expect(run.exitCode).toBe(3);
  expect(run.stderr).toContain(
    "the production App Store build number fetch failed",
  );
  expect(run.bunCalls).toEqual([
    "run store:build-numbers skip_google:true apple_live:false",
  ]);
});
