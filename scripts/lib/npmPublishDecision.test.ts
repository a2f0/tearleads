import { afterEach, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decidePublish, parseRegistryState } from "./npmPublishDecision";

const fixtures: string[] = [];
afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const published = { latest: "0.2.0", versions: ["0.1.1", "0.2.0"] };
const registryOutput = JSON.stringify({
  versions: published.versions,
  "dist-tags": { latest: published.latest },
});

test("a version newer than npm's latest is published", () => {
  expect(decidePublish("0.2.1", published).publish).toBe(true);
  expect(decidePublish("1.0.0-beta.1", published).publish).toBe(true);
});

test.each(["0.1.1", "0.2.0"])(
  "version %s, already on npm, is not published again",
  (version) => {
    expect(decidePublish(version, published)).toEqual({
      publish: false,
      reason: `${version} is already on npm`,
    });
  },
);

// Build metadata does not order versions, and npm drops it on publish, so
// 0.2.0+build.1 would collide with the published 0.2.0.
test.each(["0.1.5", "0.2.0-beta.1", "0.2.0+build.1"])(
  "version %s, not newer than npm's latest, is not published",
  (version) => {
    expect(decidePublish(version, published)).toEqual({
      publish: false,
      reason: `${version} is not newer than npm's latest (0.2.0)`,
    });
  },
);

test.each(["", "1.0", "v1.0.0", "latest"])(
  "an invalid package version %j fails",
  (version) => {
    expect(() => decidePublish(version, published)).toThrow(
      "invalid package version",
    );
  },
);

test("npm's view output is parsed, including a single version", () => {
  expect(
    parseRegistryState(
      JSON.stringify({
        versions: ["0.1.1", "0.2.0"],
        "dist-tags": { latest: "0.2.0", next: "0.3.0-beta.1" },
      }),
    ),
  ).toEqual(published);
  expect(
    parseRegistryState(
      JSON.stringify({ versions: "0.1.1", "dist-tags": { latest: "0.1.1" } }),
    ),
  ).toEqual({ latest: "0.1.1", versions: ["0.1.1"] });
});

test.each([
  "",
  "null",
  JSON.stringify({ versions: ["0.2.0"] }),
  JSON.stringify({ versions: [1], "dist-tags": { latest: "0.2.0" } }),
  JSON.stringify({ error: { code: "E404" } }),
])("unexpected npm view output %j fails", (output) => {
  expect(() => parseRegistryState(output)).toThrow();
});

// Runs the script against a fixture package with a fake npm on the PATH.
function run(
  npm: { exit: number; output: string },
  args: readonly string[] = ["windowing"],
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "publish-decision-")));
  fixtures.push(root);
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  mkdirSync(join(root, "packages", "windowing"), { recursive: true });
  mkdirSync(join(root, "bin"));
  cpSync(
    resolve(import.meta.dir, "npmPublishDecision.ts"),
    join(root, "scripts", "lib", "npmPublishDecision.ts"),
  );
  writeFileSync(
    join(root, "packages", "windowing", "package.json"),
    JSON.stringify({ name: "@tearleads/windowing", version: "0.2.1" }),
  );
  writeFileSync(
    join(root, "bin", "npm"),
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(process.env.NPM_ARGS, JSON.stringify(process.argv.slice(2)));
process.stdout.write(process.env.NPM_OUTPUT);
process.exit(Number(process.env.NPM_EXIT));
`,
    { mode: 0o755 },
  );
  const output = join(root, "github-output");
  const npmArgs = join(root, "npm-args.json");
  const { PATH } = process.env;
  const result = Bun.spawnSync(
    [
      process.execPath,
      join(root, "scripts", "lib", "npmPublishDecision.ts"),
      ...args,
    ],
    {
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${PATH}`,
        GITHUB_OUTPUT: output,
        NPM_ARGS: npmArgs,
        NPM_EXIT: String(npm.exit),
        NPM_OUTPUT: npm.output,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    npmArgs: existsSync(npmArgs)
      ? JSON.parse(readFileSync(npmArgs, "utf8"))
      : undefined,
    githubOutput: existsSync(output) ? readFileSync(output, "utf8") : undefined,
  };
}

test("the script asks npmjs.org and sets the step's publish output", () => {
  const result = run({ exit: 0, output: registryOutput });
  expect(result.exitCode).toBe(0);
  expect(result.npmArgs).toEqual([
    "view",
    "@tearleads/windowing",
    "versions",
    "dist-tags",
    "--json",
    "--registry",
    "https://registry.npmjs.org",
    "--@tearleads:registry=https://registry.npmjs.org",
  ]);
  expect(result.stdout).toContain("Publishing @tearleads/windowing");
  expect(result.githubOutput).toBe("publish=true\n");
});

test("a published version sets publish=false with a notice", () => {
  const result = run({
    exit: 0,
    output: JSON.stringify({
      versions: [...published.versions, "0.2.1"],
      "dist-tags": { latest: "0.2.1" },
    }),
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("::notice::Not publishing");
  expect(result.githubOutput).toBe("publish=false\n");
});

test.each([
  { exit: 1, output: "" },
  { exit: 1, output: registryOutput },
  { exit: 0, output: "not json" },
])("a failed registry lookup %j fails without an output", (npm) => {
  const result = run(npm);
  expect(result.exitCode).not.toBe(0);
  expect(result.githubOutput).toBeUndefined();
});

test.each([[], [""], ["../windowing"], ["Windowing"]])(
  "arguments %j are rejected before asking npm",
  (...args) => {
    const result = run({ exit: 0, output: registryOutput }, args);
    expect(result.exitCode).not.toBe(0);
    expect(result.npmArgs).toBeUndefined();
    expect(result.githubOutput).toBeUndefined();
  },
);
