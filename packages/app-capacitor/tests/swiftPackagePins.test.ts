import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const helperPath = resolve(
  import.meta.dir,
  "../fastlane/lib/swift_package_pins.rb",
);

const archiveScript = `
require "json"
require ARGV.fetch(0)
path = ARGV.fetch(1)
built = false
begin
  result = SwiftPackagePins.verify_around(path) do
    built = true
    File.write(path, "{ \\"pins\\" : [\\"2.0.1\\"] }\\n") if ARGV.fetch(2) == "rewrite"
    "built"
  end
  puts JSON.generate(built: built, result: result)
rescue SwiftPackagePins::MismatchError => e
  puts JSON.generate(built: built, error: e.message)
end
`;

// Hooks export GIT_DIR and friends; the fixture repository must never see them.
function isolatedEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
}

async function run(command: string[], cwd: string) {
  const child = Bun.spawn(command, {
    cwd,
    env: isolatedEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  return stdout;
}

async function archive(scenario: string) {
  const root = await mkdtemp(join(tmpdir(), "swift-package-pins-"));
  const path = join(root, "Package.resolved");
  try {
    const git = (...args: string[]) =>
      run(
        [
          "git",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "user.name=Pins Test",
          "-c",
          "user.email=pins@example.com",
          ...args,
        ],
        root,
      );
    await git("init", "-q");
    await Bun.write(path, '{ "pins" : ["2.0.0"] }\n');
    if (scenario !== "uncommitted") {
      await git("add", "Package.resolved");
      await git("commit", "-q", "-m", "pins");
    }
    if (scenario === "stale") {
      await Bun.write(path, '{ "pins" : ["2.0.1"] }\n');
    }
    const stdout = await run(
      ["ruby", "-e", archiveScript, helperPath, path, scenario],
      root,
    );
    return JSON.parse(stdout);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("an archive with the committed pins returns its result", async () => {
  expect(await archive("unchanged")).toEqual({ built: true, result: "built" });
});

test("pins left changed by an earlier build refuse the archive before it starts", async () => {
  const outcome = await archive("stale");
  expect(outcome.built).toBe(false);
  expect(outcome.error).toContain("differs from HEAD before the release build");
});

test("pins the build rewrites refuse the archive afterwards", async () => {
  const outcome = await archive("rewrite");
  expect(outcome.built).toBe(true);
  expect(outcome.error).toContain("differs from HEAD after the release build");
});

test("an uncommitted lockfile refuses the archive", async () => {
  const outcome = await archive("uncommitted");
  expect(outcome.built).toBe(false);
  expect(outcome.error).toContain("is not committed at HEAD");
});
