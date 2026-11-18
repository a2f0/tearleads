import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { desktopSourceCommit } from "./desktopSourceCommit";

const exportedCommit = "1234567890abcdef1234567890abcdef12345678";
const buildInfoDir = resolve(import.meta.dirname, "../../..", "scripts/lib");

for (const checkout of [false, true]) {
  test(`build identity respects ${checkout ? "the checkout" : "an exported source archive"}`, async () => {
    const matrix = await mkdtemp(join(tmpdir(), "tearleads-source-commit-"));
    const root = join(matrix, "checkouts/tearleads");
    try {
      await mkdir(join(root, "scripts/lib"), { recursive: true });
      for (const file of ["withBuildInfoEnv.sh", "packageVersions.ts"])
        await copyFile(
          join(buildInfoDir, file),
          join(root, "scripts/lib", file),
        );
      await Bun.write(join(root, "package.json"), '{"version":"1.2.3"}');
      const { PATH } = process.env;
      const git = (cwd: string, ...args: string[]) =>
        execFileSync(
          "git",
          [
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.test",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=/dev/null",
            ...args,
          ],
          {
            cwd,
            encoding: "utf8",
            env: {
              PATH,
              GIT_CONFIG_GLOBAL: "/dev/null",
              GIT_CONFIG_NOSYSTEM: "1",
            },
          },
        ).trim();
      git(matrix, "init", "-q");
      git(matrix, "commit", "--allow-empty", "-qm", "matrix");
      let head = "";
      if (checkout) {
        git(root, "init", "-q");
        git(root, "add", ".");
        git(root, "commit", "-qm", "checkout");
        head = git(root, "rev-parse", "HEAD");
      }
      await mkdir(join(root, "bin"));
      await symlink(process.execPath, join(root, "bin", "bun"));
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
            join(root, "scripts/lib/withBuildInfoEnv.sh"),
            "bun",
            "-e",
            "console.log(JSON.stringify({sha:process.env.BUN_PUBLIC_GIT_SHA,version:process.env.BUN_PUBLIC_APP_VERSION}))",
          ],
          {
            cwd: root,
            env: {
              PATH: `${root}/bin:${PATH}`,
              BUILD_GIT_SHA: override,
              GIT_DIR: join(matrix, ".git"),
              GIT_WORK_TREE: matrix,
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
      await rm(matrix, { recursive: true, force: true });
    }
  });
}
