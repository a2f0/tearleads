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

const publishedPackages = ["windowing", "client-sdk"];

function fixture() {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "npm publish scripts ")),
  );
  fixtures.push(root);
  const bin = join(root, "bin");
  const scripts = join(root, "scripts");
  for (const directory of [bin, scripts]) {
    mkdirSync(directory, { recursive: true });
  }
  cpSync(
    resolve(import.meta.dir, "../publishNpmPackage.sh"),
    join(scripts, "publishNpmPackage.sh"),
  );
  for (const name of publishedPackages) {
    const packageRoot = join(root, "packages", name);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: `@tearleads/${name}`,
        version: "1.2.3",
        private: true,
        exports: { ".": "./src/index.ts" },
      }),
    );
  }
  for (const tool of ["bun", "npm"]) {
    writeFileSync(join(bin, tool), fakeTool, { mode: 0o755 });
  }
  const log = join(root, "calls.jsonl");
  const { PATH } = process.env;
  return {
    root,
    packageRoot(name: string) {
      return join(root, "packages", name);
    },
    run(args: readonly string[], overrides: Record<string, string> = {}) {
      return Bun.spawnSync(
        ["bash", join(scripts, "publishNpmPackage.sh"), ...args],
        {
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
        },
      );
    },
    calls(): ToolCall[] {
      if (!existsSync(log)) return [];
      return readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    },
    remainingBuilds() {
      return readdirSync(root).filter((name) => name.includes("-publish."));
    },
  };
}

test.each(publishedPackages)(
  "publishes the rebuilt %s consumer package and forwards release options",
  (name) => {
    const repo = fixture();
    const result = repo.run([
      name,
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
      repo.packageRoot(name),
      "package",
    ]);
    expect(build?.args[4]).toBe(publish?.cwd);
    expect(publish?.cwd).not.toBe(repo.packageRoot(name));
    expect(publish?.manifest).toEqual({
      name: `@tearleads/${name}`,
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

// The root publish:npm:dry-run script passes its own option first.
test("the package may follow the options", () => {
  const repo = fixture();
  expect(repo.run(["--dry-run", "client-sdk"]).exitCode).toBe(0);
  const [build, publish] = repo.calls();
  expect(build?.args[2]).toBe(repo.packageRoot("client-sdk"));
  expect(publish?.args).toContain("--dry-run");
});

test("a normal release uses the latest tag without a dry run", () => {
  const repo = fixture();
  expect(repo.run(["windowing"]).exitCode).toBe(0);
  const publish = repo.calls()[1];
  expect(publish?.args).toContain("latest");
  expect(publish?.args).not.toContain("--dry-run");
  expect(publish?.args).not.toContain("--otp");
});

test("a failed build stops before npm and removes the temporary build", () => {
  const repo = fixture();
  expect(repo.run(["windowing"], { BUILD_EXIT: "17" }).exitCode).toBe(17);
  expect(repo.calls().map((call) => call.command)).toEqual(["bun"]);
  expect(repo.remainingBuilds()).toEqual([]);
});

test("a failed publish preserves its exit status and removes the temporary build", () => {
  const repo = fixture();
  expect(repo.run(["windowing"], { PUBLISH_EXIT: "23" }).exitCode).toBe(23);
  expect(repo.calls().map((call) => call.command)).toEqual(["bun", "npm"]);
  expect(repo.remainingBuilds()).toEqual([]);
});

test.each([
  { args: [] },
  { args: ["crypto"] },
  { args: ["windowing", "client-sdk"] },
  { args: ["windowing", "--tag"] },
  { args: ["windowing", "--otp"] },
  { args: ["windowing", "--tag", "--dry-run"] },
  { args: ["windowing", "--unknown"] },
])("invalid arguments %j fail before building or publishing", ({ args }) => {
  const repo = fixture();
  expect(repo.run(args).exitCode).toBe(1);
  expect(repo.calls()).toEqual([]);
  expect(repo.remainingBuilds()).toEqual([]);
});

test("help lists the published packages without invoking external tools", () => {
  const repo = fixture();
  const result = repo.run(["--help"]);
  expect(result.exitCode).toBe(0);
  for (const name of publishedPackages) {
    expect(result.stdout.toString()).toContain(`@tearleads/${name}`);
  }
  expect(repo.calls()).toEqual([]);
});
