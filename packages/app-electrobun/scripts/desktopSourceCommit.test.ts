import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { desktopSourceCommit } from "./desktopSourceCommit";

const exportedCommit = "1234567890abcdef1234567890abcdef12345678";
const buildInfoWrapper = resolve(
  import.meta.dirname,
  "../../..",
  "scripts/lib/withBuildInfoEnv.sh",
);

for (const checkout of [false, true]) {
  test(`build identity respects ${checkout ? "the checkout" : "an exported source archive"}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "tearleads-source-commit-"));
    try {
      await Bun.write(join(root, "package.json"), '{"version":"1.2.3"}');
      let head = "";
      if (checkout) {
        // Fixture Git calls run with no GIT_* variable, so none reaches the
        // repository running these tests.
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => !name.startsWith("GIT_"),
          ),
        );
        const git = (...args: string[]) =>
          execFileSync("git", args, {
            cwd: root,
            env,
            encoding: "utf8",
          }).trim();
        git("init", "-q");
        git("add", ".");
        git(
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.test",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-qm",
          "fixture",
        );
        head = git("rev-parse", "HEAD");
      }
      await mkdir(join(root, "bin"));
      await symlink(process.execPath, join(root, "bin", "bun"));
      const { PATH: inheritedPath } = process.env;
      for (const override of [exportedCommit, "", undefined]) {
        if (checkout || override) {
          expect(desktopSourceCommit(root, override)).toBe(
            checkout ? head : exportedCommit,
          );
        } else {
          expect(() => desktopSourceCommit(root, override)).toThrow();
        }
        const child = Bun.spawn(
          [
            "sh",
            buildInfoWrapper,
            "bun",
            "-e",
            "console.log(JSON.stringify({sha:process.env.BUN_PUBLIC_GIT_SHA,version:process.env.BUN_PUBLIC_APP_VERSION}))",
          ],
          {
            cwd: root,
            env: {
              PATH: `${root}/bin:${inheritedPath}`,
              BUILD_GIT_SHA: override,
            },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [exitCode, output, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(exitCode, stderr).toBe(0);
        expect(JSON.parse(output)).toEqual({
          sha: checkout
            ? head.slice(0, 7)
            : override
              ? override.slice(0, 7)
              : "unknown",
          version: "1.2.3",
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
