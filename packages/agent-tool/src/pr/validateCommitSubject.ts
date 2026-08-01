import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const COMMITLINT_CONFIG = "commitlint.config.mts";

/**
 * Validate a commit subject with the repository's own commitlint setup — the
 * same `@commitlint/cli` binary and `commitlint.config.mts` the commit-msg hook
 * runs — so squash subjects obey identical conventional-commit and
 * header-length rules. Throws with commitlint's report when the subject is
 * rejected.
 */
export function validateCommitSubject(rootDir: string, subject: string): void {
  const commitlintBin = path.join(
    rootDir,
    "node_modules",
    ".bin",
    "commitlint",
  );
  if (!existsSync(commitlintBin)) {
    throw new Error(
      `commitlint CLI not found at ${commitlintBin}. Run 'bun install' first.`,
    );
  }

  const result = spawnSync(commitlintBin, ["--config", COMMITLINT_CONFIG], {
    cwd: rootDir,
    input: subject,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const report = `${result.stdout}${result.stderr}`.trim();
    throw new Error(
      `Commit subject rejected by commitlint:\n${
        report.length > 0
          ? report
          : `commitlint exited with code ${result.status}`
      }`,
    );
  }
}
