import { afterEach, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixtures: string[] = [];
afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface ToolCall {
  command: string;
  args: string[];
  cwd: string;
  manifest?: {
    name: string;
    version: string;
    private?: boolean;
    main?: string;
  };
  hasEntry?: boolean;
  scopedRegistry?: string;
}

// Intercept both external tools so these release-flow tests cannot upload.
// The fake build writes a consumer manifest distinct from the private source
// manifest; npm records the manifest and files it actually receives.
const fakeTool = String.raw`#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
const call = { command, args, cwd: process.cwd() };
if (command === "npm") {
  call.manifest = JSON.parse(readFileSync("package.json", "utf8"));
  call.hasEntry = existsSync("index.js");
  call.scopedRegistry = readFileSync(".npmrc", "utf8");
}
appendFileSync(process.env.PUBLISH_LOG, JSON.stringify(call) + "\n");
if (command === "bun") {
  if (process.env.BUILD_EXIT) process.exit(Number(process.env.BUILD_EXIT));
  const source = JSON.parse(readFileSync(join(args[2], "package.json"), "utf8"));
  const output = args.at(-1);
  writeFileSync(join(output, "package.json"), JSON.stringify({
    name: source.name, version: source.version, main: "./index.js"
  }));
  writeFileSync(join(output, "index.js"), "export const Window = () => null;\n");
}
process.exit(command === "npm" ? Number(process.env.PUBLISH_EXIT ?? 0) : 0);
`;

function fixture() {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "windowing publish scripts ")),
  );
  fixtures.push(root);
  const bin = join(root, "bin");
  const scripts = join(root, "scripts");
  const packageRoot = join(root, "packages", "windowing");
  for (const directory of [bin, scripts, packageRoot]) {
    mkdirSync(directory, { recursive: true });
  }
  for (const script of ["publishNpmModules.sh", "publishWindowing.sh"]) {
    cpSync(
      resolve(import.meta.dir, "../../../scripts", script),
      join(scripts, script),
    );
  }
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@tearleads/windowing",
      version: "1.2.3",
      private: true,
      exports: { ".": "./src/index.ts" },
    }),
  );
  for (const tool of ["bun", "npm"]) {
    writeFileSync(join(bin, tool), fakeTool, { mode: 0o755 });
  }
  const log = join(root, "calls.jsonl");
  const { PATH } = process.env;
  return {
    root,
    packageRoot,
    run(
      script: string,
      args: readonly string[],
      overrides: Record<string, string> = {},
    ) {
      return Bun.spawnSync(["bash", join(scripts, script), ...args], {
        cwd: tmpdir(),
        env: {
          ...process.env,
          PATH: `${bin}:${PATH}`,
          TMPDIR: root,
          PUBLISH_LOG: log,
          BUILD_EXIT: "",
          PUBLISH_EXIT: "0",
          ...overrides,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    },
    calls(): ToolCall[] {
      if (!existsSync(log)) return [];
      return readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    },
    remainingBuilds() {
      return readdirSync(root).filter((name) =>
        name.startsWith("tearleads-windowing-publish."),
      );
    },
  };
}

test.each(["publishNpmModules.sh", "publishWindowing.sh"])(
  "%s publishes the rebuilt consumer package and forwards release options",
  (script) => {
    const repo = fixture();
    const result = repo.run(script, [
      "--dry-run",
      "--tag",
      "next",
      "--otp",
      "123456",
    ]);
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    const [build, publish] = repo.calls();
    expect(repo.calls()).toHaveLength(2);
    expect(build?.command).toBe("bun");
    expect(build?.args.slice(0, 4)).toEqual([
      "run",
      "--cwd",
      repo.packageRoot,
      "package",
    ]);
    expect(build?.args[4]).toBe(publish?.cwd);
    expect(publish?.cwd).not.toBe(repo.packageRoot);
    expect(publish?.manifest).toEqual({
      name: "@tearleads/windowing",
      version: "1.2.3",
      main: "./index.js",
    });
    expect(publish?.hasEntry).toBe(true);
    expect(publish?.scopedRegistry).toBe(
      "@tearleads:registry=https://registry.npmjs.org\n",
    );
    expect(publish?.args).toEqual([
      "publish",
      "--access",
      "public",
      "--registry",
      "https://registry.npmjs.org",
      "--tag",
      "next",
      "--dry-run",
      "--otp",
      "123456",
    ]);
    expect(repo.remainingBuilds()).toEqual([]);
  },
);

test("a normal release uses the latest tag without a dry run", () => {
  const repo = fixture();
  expect(repo.run("publishNpmModules.sh", []).exitCode).toBe(0);
  const publish = repo.calls()[1];
  expect(publish?.args).toContain("latest");
  expect(publish?.args).not.toContain("--dry-run");
  expect(publish?.args).not.toContain("--otp");
});

test("a failed build stops before npm and removes the temporary build", () => {
  const repo = fixture();
  expect(
    repo.run("publishNpmModules.sh", [], { BUILD_EXIT: "17" }).exitCode,
  ).toBe(17);
  expect(repo.calls().map((call) => call.command)).toEqual(["bun"]);
  expect(repo.remainingBuilds()).toEqual([]);
});

test("a failed publish preserves its exit status and removes the temporary build", () => {
  const repo = fixture();
  expect(
    repo.run("publishNpmModules.sh", [], { PUBLISH_EXIT: "23" }).exitCode,
  ).toBe(23);
  expect(repo.calls().map((call) => call.command)).toEqual(["bun", "npm"]);
  expect(repo.remainingBuilds()).toEqual([]);
});

test.each([
  { args: ["--tag"] },
  { args: ["--otp"] },
  { args: ["--tag", "--dry-run"] },
  { args: ["--unknown"] },
])("invalid options %j fail before building or publishing", ({ args }) => {
  const repo = fixture();
  expect(repo.run("publishNpmModules.sh", args).exitCode).toBe(1);
  expect(repo.calls()).toEqual([]);
  expect(repo.remainingBuilds()).toEqual([]);
});

test("help describes the publish set without invoking external tools", () => {
  const repo = fixture();
  const result = repo.run("publishNpmModules.sh", ["--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("@tearleads/windowing");
  expect(repo.calls()).toEqual([]);
});
