import { afterAll, beforeAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sourceScripts = resolve(import.meta.dirname, "../../../scripts");
let root: string;

beforeAll(async () => {
  root = await realpath(
    await mkdtemp(join(tmpdir(), "tearleads desktop wrappers-")),
  );
  await mkdir(join(root, "scripts/lib"), { recursive: true });
  const packageScripts = join(root, "packages/app-electrobun/scripts");
  await mkdir(packageScripts, { recursive: true });
  await cp(
    join(sourceScripts, "lib/desktopRelease.sh"),
    join(root, "scripts/lib/desktopRelease.sh"),
  );
  for (const platform of ["Macos", "Linux"]) {
    await Bun.write(
      join(packageScripts, `release${platform}.sh`),
      [
        "#!/bin/sh",
        `printf '%s\\n' '${platform.toLowerCase()}' "$PWD" "$@"`,
        'exit "$DESKTOP_WRAPPER_TEST_EXIT"',
      ].join("\n"),
    );
    for (const action of ["build", "upload"]) {
      for (const suffix of ["Release", "StagingRelease"]) {
        const name = `${action}${platform}${suffix}.sh`;
        await cp(join(sourceScripts, name), join(root, "scripts", name));
      }
    }
  }
  const { scripts } = await Bun.file(
    resolve(import.meta.dirname, "../package.json"),
  ).json();
  await Bun.write(
    join(root, "packages/app-electrobun/package.json"),
    JSON.stringify({ scripts }),
  );
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function run(command: string[], failure = false) {
  const { PATH: inheritedPath } = process.env;
  const child = Bun.spawn(command, {
    // Match invoking a convenience script from outside its checkout.
    cwd: tmpdir(),
    env: {
      PATH: inheritedPath,
      DESKTOP_WRAPPER_TEST_EXIT: failure ? "7" : "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

for (const platform of ["Macos", "Linux"]) {
  for (const action of ["build", "upload"]) {
    for (const tier of ["staging", "production"]) {
      const name = `${action}${platform}${tier === "staging" ? "Staging" : ""}Release.sh`;
      const command = () => ["sh", join(root, "scripts", name)];
      test(`${name} selects ${tier} without arguments from any directory`, async () => {
        const result = await run(command());
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout.trim().split("\n")).toEqual([
          platform.toLowerCase(),
          root,
          action,
          tier,
        ]);
      });
      test(`${name} shows help and rejects invalid input before invoking the backend`, async () => {
        for (const flag of ["--help", "-h"]) {
          const help = await run([...command(), flag]);
          expect(help.exitCode).toBe(0);
          expect(help.stdout).toContain(
            `Runs the ${tier} ${platform.toLowerCase()} release ${action}`,
          );
          expect(help.stdout).not.toContain(root);
        }
        for (const args of [
          ["prod"],
          [""],
          ["staging", "extra"],
          ...(tier === "staging" ? [["production"]] : []),
        ]) {
          const result = await run([...command(), ...args]);
          expect(result.exitCode).toBe(1);
          expect(result.stdout).toBe("");
          expect(result.stderr).toContain("Usage:");
        }
      });
      test(`${name} preserves backend failures`, async () => {
        expect((await run(command(), true)).exitCode).toBe(7);
      });
    }
    for (const tier of ["staging", "production"]) {
      test(`${action}${platform}Release.sh preserves the explicit ${tier} form`, async () => {
        const result = await run([
          "sh",
          join(root, "scripts", `${action}${platform}Release.sh`),
          tier,
        ]);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout.trim().split("\n")).toEqual([
          platform.toLowerCase(),
          root,
          action,
          tier,
        ]);
      });
    }
  }
}

for (const [name, platform, action, tier] of [
  ["build:staging", "macos", "build", "staging"],
  ["build:release", "macos", "build", "production"],
  ["upload:staging", "macos", "upload", "staging"],
  ["upload:release", "macos", "upload", "production"],
  ["build:linux", "linux", "build", "production"],
  ["upload:linux", "linux", "upload", "production"],
  ["build:linux:staging", "linux", "build", "staging"],
  ["build:linux:release", "linux", "build", "production"],
  ["upload:linux:staging", "linux", "upload", "staging"],
  ["upload:linux:release", "linux", "upload", "production"],
] as const) {
  test(`package shortcut ${name} selects ${tier} ${platform}`, async () => {
    const result = await run([
      process.execPath,
      "run",
      "--cwd",
      join(root, "packages/app-electrobun"),
      name,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      platform,
      root,
      action,
      tier,
    ]);
  });
}
