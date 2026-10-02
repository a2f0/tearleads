import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { VerificationReport } from "../../testing/verificationReport";
import { fixture } from "./fixture.testUtils";

const runner = resolve(import.meta.dir, "../../testing/runVerification.ts");

export function verificationFixture(failingStep = "") {
  const repo = fixture();
  repo.write(
    "package.json",
    JSON.stringify({
      workspaces: [
        "packages/api",
        "packages/app",
        "packages/client-sdk",
        "packages/empty",
      ],
    }),
  );
  for (const [path, name, scripts] of [
    ["api", "@tearleads/api", { test: "api-tests" }],
    ["app", "app", { test: "app-tests" }],
    ["client-sdk", "@tearleads/client-sdk", { test: "sdk-tests" }],
    ["empty", "empty", {}],
  ] as const) {
    repo.write(
      `packages/${path}/package.json`,
      JSON.stringify({ name, scripts }),
    );
  }
  repo.write(".gitignore", "packages/client-sdk/dist/\nbin/\n");
  repo.write("packages/client-sdk/src/version", "old-sdk");
  repo.write("packages/client-sdk/dist/version", "old-sdk");
  const head = repo.commit();
  repo.write("packages/client-sdk/src/version", "new-sdk");
  repo.write(
    "bin/bun",
    `#!${process.execPath}
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(".git/commands.ndjson", JSON.stringify(args) + "\\n");
const step = args.includes("build:packages") ? "build"
  : args.includes("tsc") ? "typescript"
  : args.includes("check:fast") ? "static" : "tests";
if (step === process.env.FAILING_STEP) process.exit(23);
if (step === "build" && process.env.WAIT_IN_BUILD === "true") await Bun.sleep(10000);
if (step === "build") {
  mkdirSync("packages/client-sdk/dist", { recursive: true });
  copyFileSync("packages/client-sdk/src/version", "packages/client-sdk/dist/version");
}
if (step === "tests") {
  if (readFileSync("packages/client-sdk/src/version", "utf8") !== readFileSync("packages/client-sdk/dist/version", "utf8")) process.exit(42);
  if (process.env.CHANGE_SOURCE === "true") writeFileSync("packages/client-sdk/src/version", "changed-during-tests");
  if (process.env.CHANGE_UNTRACKED === "true") writeFileSync("new-source.ts", "changed-untracked");
  if (process.env.CHANGE_HEAD === "true") {
    Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "advance"], { stdout: "ignore", stderr: "inherit" });
  }
}
`,
  );
  chmodSync(join(repo.cwd, "bin/bun"), 0o755);
  const { PATH = "" } = process.env;
  const env = {
    ...repo.env,
    PATH: `${join(repo.cwd, "bin")}:${PATH}`,
    FAILING_STEP: failingStep,
  };
  const run = (args: string[], extraEnv: Record<string, string> = {}) => {
    const result = Bun.spawnSync([process.execPath, runner, ...args], {
      cwd: repo.cwd,
      env: { ...env, ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
    const directory = join(repo.cwd, ".git/verification");
    const files = existsSync(directory) ? readdirSync(directory) : [];
    const reports = files
      .filter((name) => name.endsWith(".json"))
      .map(
        (name) =>
          JSON.parse(
            readFileSync(join(directory, name), "utf8"),
          ) as VerificationReport,
      );
    const log = join(repo.cwd, ".git/commands.ndjson");
    const commands = !existsSync(log)
      ? []
      : readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[]);
    return {
      code: result.exitCode,
      output: result.stdout.toString() + result.stderr.toString(),
      reports,
      commands,
    };
  };
  const start = (args: string[], extraEnv: Record<string, string>) =>
    Bun.spawn([process.execPath, runner, ...args], {
      cwd: repo.cwd,
      env: { ...env, ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
  return {
    ...repo,
    head,
    run,
    start,
    cleanup: () => rmSync(repo.cwd, { recursive: true, force: true }),
  };
}
