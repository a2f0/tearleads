import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopSentryCommit } from "./sentryReleaseSource";

test("desktop source-map publishing requires committed sources, including staged and untracked files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desktop-sentry-git-"));
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("GIT_")) delete env[name];
  }
  const git = (...args: string[]) =>
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
      {
        cwd: directory,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
