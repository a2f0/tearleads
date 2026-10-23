import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fixtures: string[] = [];
const root = resolve(import.meta.dir, "../..");
const registryOutput = JSON.stringify({
  versions: ["0.1.1", "0.2.0"],
  "dist-tags": { latest: "0.2.0" },
});

afterEach(() => {
  for (const path of fixtures.splice(0))
    rmSync(path, { recursive: true, force: true });
});

// Exercise the installed release CLI against a private source manifest. The
// fake npm records registry arguments and never contacts or mutates a registry.
function plan(
  version: string,
  lookup = { exit: 0, output: registryOutput },
  allowPrivate = true,
) {
  const directory = mkdtempSync(join(tmpdir(), "tearleads-release-plan-"));
  fixtures.push(directory);
  mkdirSync(join(directory, "bin"));
  const manifest = join(directory, "package.json");
  writeFileSync(
    manifest,
    JSON.stringify({ name: "@tearleads/windowing", version, private: true }),
  );
  writeFileSync(
    join(directory, "bin/npm"),
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(process.env.NPM_ARGS, JSON.stringify(process.argv.slice(2)));
process.stdout.write(process.env.NPM_OUTPUT);
process.exit(Number(process.env.NPM_EXIT));
`,
    { mode: 0o755 },
  );
  const output = join(directory, "github-output");
  const args = join(directory, "npm-args.json");
  const { PATH = "" } = process.env;
  const result = Bun.spawnSync(
    [
      process.execPath,
      join(root, "node_modules/.bin/agent-tool"),
      "release",
      "plan",
      manifest,
      ...(allowPrivate ? ["--allow-private-source"] : []),
      "--github-output",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${join(directory, "bin")}:${PATH}`,
        GITHUB_OUTPUT: output,
        NPM_ARGS: args,
        NPM_EXIT: String(lookup.exit),
        NPM_OUTPUT: lookup.output,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    args: existsSync(args) ? JSON.parse(readFileSync(args, "utf8")) : undefined,
    output: existsSync(output) ? readFileSync(output, "utf8") : undefined,
  };
}

test("private-source planning pins both public registry selectors and emits a new stable release", () => {
  const result = plan("0.2.1");
  expect(result.code, result.stderr).toBe(0);
  expect(result.args).toEqual([
    "view",
    "@tearleads/windowing",
    "versions",
    "dist-tags",
    "--json",
    "--registry",
    "https://registry.npmjs.org",
    "--@tearleads:registry=https://registry.npmjs.org",
  ]);
  expect(result.output).toBe("publish=true\n");
  expect(JSON.parse(result.stdout).privateSource).toBe(true);
});

test.each(["0.1.1", "0.2.0", "0.1.5"])(
  "existing or older %s never publishes",
  (version) => {
    const result = plan(version);
    expect(result.code, result.stderr).toBe(0);
    expect(result.output).toBe("publish=false\n");
  },
);

test.each(["0.2.0+build.1", "0.3.0-beta.1"])(
  "non-stable %s fails without publish output",
  (version) => {
    const result = plan(version);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("invalid package version");
    expect(result.output).toBeUndefined();
  },
);

test("private sources require explicit opt-in before registry access", () => {
  const result = plan("0.2.1", undefined, false);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Private source manifest");
  expect(result.args).toBeUndefined();
  expect(result.output).toBeUndefined();
});

test.each([
  { exit: 1, output: "" },
  { exit: 1, output: registryOutput },
  { exit: 0, output: "not json" },
  { exit: 1, output: JSON.stringify({ error: { code: "E404" } }) },
])("registry failure %j never creates publish output", (lookup) => {
  const result = plan("0.2.1", lookup);
  expect(result.code).toBe(1);
  expect(result.stderr.length).toBeGreaterThan(0);
  expect(result.output).toBeUndefined();
});
