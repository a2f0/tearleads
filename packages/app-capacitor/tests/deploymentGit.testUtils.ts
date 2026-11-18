import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function commitDeploymentFixture(
  root: string,
  message: string,
  tracked?: string,
): string {
  const { PATH } = process.env;
  const git = (...args: string[]) =>
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
        cwd: root,
        env: { PATH, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
        encoding: "utf8",
      },
    ).trim();
  git("init", "--quiet");
  // Track only selected source. Test logs, credentials and build output stay untracked.
  writeFileSync(join(root, ".git/info/exclude"), "*\n");
  if (tracked) git("add", "--force", "--", tracked);
  git("commit", "--allow-empty", "-qm", message);
  return git("rev-parse", "HEAD");
}
