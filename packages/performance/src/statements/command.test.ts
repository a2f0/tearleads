import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { runTestProcess } from "../testProcess";
import { runStatementCommand, type StatementHost } from "./command";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

type TestRun = Parameters<typeof runTestProcess>[0];

const record = '{"label":"test-1","sql":"select 1","params":0}\n';

/**
 * A host with `api` and `app` packages under a temporary root, whose test
 * process writes `capture` to the capture file, when given, and exits with
 * `exitCode`.
 */
async function fakeHost(
  input: {
    env?: Record<string, string>;
    capture?: string;
    exitCode?: number;
  } = {},
) {
  const root = await mkdtemp(resolve(tmpdir(), "statement-command-"));
  directories.push(root);
  const packagesRoot = resolve(root, "packages");
  for (const name of ["api", "app"])
    await mkdir(resolve(packagesRoot, name), { recursive: true });
  await writeFile(resolve(packagesRoot, "notes"), "not a package");
  const runs: TestRun[] = [];
  const printed: string[] = [];
  const host: StatementHost = {
    packagesRoot,
    reportDirectory: resolve(root, "reports"),
    env: input.env ?? {},
    runTests: async (run) => {
      runs.push(run);
      await writeFile(run.log, "test output\n");
      const { PERF_STATEMENTS_OUT: out } = run.env;
      if (input.capture !== undefined && out)
        await writeFile(out, input.capture);
      return { exitCode: input.exitCode ?? 0, timedOut: false, wallMs: 1 };
    },
    print: (text) => printed.push(text),
  };
  return { host, packagesRoot, root, runs, printed };
}

const run = (...args: string[]) => ["--file", "src/a.test.ts", ...args];

test("runs the files in the named package with the capture preload last", async () => {
  const fake = await fakeHost({ capture: record });
  expect(
    await runStatementCommand(
      ["--package", "app", ...run("--name", "budget", "--limit", "9")],
      fake.host,
    ),
  ).toBe(0);
  const [only] = fake.runs;
  expect(only?.cwd).toBe(resolve(fake.packagesRoot, "app"));
  expect(only?.args).toEqual([
    "--preload",
    expect.stringMatching(/\/statements\/capturePreload\.ts$/u),
    "./src/a.test.ts",
    "-t",
    "budget",
  ]);
  expect(only?.env).toMatchObject({
    PERF_STATEMENTS_PARAM_HASH: "0",
    PERF_STATEMENTS_LIMIT: "9",
  });
  expect(only?.env).not.toHaveProperty("API_DATABASE");
  const saved = await readdir(resolve(fake.root, "reports"));
  expect(saved.map((name) => name.replace(/-[0-9a-f-]{36}/u, ""))).toEqual(
    expect.arrayContaining([
      "statements.json",
      "statements.jsonl",
      "statements.log",
      "statements.md",
    ]),
  );
});

test("API tests use the in-memory database unless one is set", async () => {
  const defaulted = await fakeHost({ capture: record });
  await runStatementCommand(["--package", "api", ...run()], defaulted.host);
  expect(defaulted.runs[0]?.env).toMatchObject({ API_DATABASE: "memory" });
  const chosen = await fakeHost({
    capture: record,
    env: { API_DATABASE: "postgres" },
  });
  await runStatementCommand(["--package", "api", ...run()], chosen.host);
  expect(chosen.runs[0]?.env).toMatchObject({ API_DATABASE: "postgres" });
});

test("refuses a package that is not a directory under packages", async () => {
  const fake = await fakeHost({ capture: record });
  for (const name of ["missing", "notes"])
    await expect(
      runStatementCommand(["--package", name, ...run()], fake.host),
    ).rejects.toThrow(`packages/${name} does not exist.`);
  expect(fake.runs).toEqual([]);
});

test("exits 1 when no capture is written or the tests fail", async () => {
  const empty = await fakeHost();
  expect(
    await runStatementCommand(["--package", "api", ...run()], empty.host),
  ).toBe(1);
  expect(empty.printed.at(-1)).toMatch(/^No statements were recorded\./u);
  const failed = await fakeHost({ capture: record, exitCode: 1 });
  expect(
    await runStatementCommand(["--package", "api", ...run()], failed.host),
  ).toBe(1);
  expect(failed.printed[0]).toBe("test output");
});

test("summarizes a saved capture without running tests", async () => {
  const fake = await fakeHost();
  const capture = resolve(fake.root, "saved.jsonl");
  await writeFile(capture, record);
  expect(await runStatementCommand(["--summarize", capture], fake.host)).toBe(
    0,
  );
  expect(fake.runs).toEqual([]);
  expect(fake.printed.join("\n")).toContain("select 1");
  await expect(
    runStatementCommand(
      ["--summarize", resolve(fake.root, "none.jsonl")],
      fake.host,
    ),
  ).rejects.toThrow(/There is no capture at/u);
});
