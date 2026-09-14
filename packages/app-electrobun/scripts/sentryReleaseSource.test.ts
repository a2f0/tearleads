import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopSentryCommit } from "./sentryReleaseSource";

const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name.startsWith("GIT_")) delete env[name];
}
const fixtureGit = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "user.name=Sentry test",
      "-c",
      "user.email=sentry-test@example.invalid",
      ...args,
    ],
    { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

test("desktop source-map publishing requires committed sources, including staged and untracked files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desktop-sentry-git-"));
  const git = (...args: string[]) => fixtureGit(directory, ...args);
  try {
    git("init", "--quiet");
    await Bun.write(join(directory, ".gitignore"), ".secrets/\nbuild/\n");
    await Bun.write(join(directory, "source.ts"), "export const value = 1;\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "Fixture");
    const commit = git("rev-parse", "HEAD").trim();
    expect(desktopSentryCommit(directory)).toBe(commit);
    await Bun.write(join(directory, "source.ts"), "export const value = 2;\n");
    expect(() => desktopSentryCommit(directory)).toThrow(/clean Git checkout/);
    git("add", "source.ts");
    expect(() => desktopSentryCommit(directory)).toThrow(/clean Git checkout/);
    git("restore", "--staged", "--worktree", "source.ts");
    await Bun.write(
      join(directory, "newModule.ts"),
      "export const value = 3;\n",
    );
    expect(() => desktopSentryCommit(directory)).toThrow(/clean Git checkout/);
    await rm(join(directory, "newModule.ts"));
    await Bun.write(
      join(directory, ".secrets/fixture.env"),
      "SYNTHETIC=ignored\n",
    );
    await Bun.write(
      join(directory, "build/sentry-sourcemaps/fixture.js"),
      "staged output",
    );
    git("checkout", "--quiet", "--detach");
    expect(desktopSentryCommit(directory)).toBe(commit);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// Git looks above a root whose .git is no repository; a clean checkout there
// must not stand in for it.
test("desktop source-map publishing refuses a root below another checkout", async () => {
  const parent = await mkdtemp(join(tmpdir(), "desktop-sentry-parent-"));
  try {
    await Bun.write(join(parent, ".gitignore"), "nested/\n");
    fixtureGit(parent, "init", "--quiet");
    fixtureGit(parent, "add", ".");
    fixtureGit(parent, "commit", "--quiet", "-m", "Fixture");
    const nested = join(parent, "nested");
    await mkdir(join(nested, ".git"), { recursive: true });
    expect(() => desktopSentryCommit(nested)).toThrow(
      /top level of its own Git checkout/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
