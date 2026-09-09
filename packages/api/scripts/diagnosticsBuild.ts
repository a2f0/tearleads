import { execFileSync } from "node:child_process";
import { isSentryCommit } from "@tearleads/diagnostics/config";

export function diagnosticsBuild(sourceRoot: string) {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8",
  }).trim();
  if (!isSentryCommit(commit))
    throw new Error("Cannot determine the API release commit");
  const files = execFileSync("git", ["ls-files", "-z", "packages"], {
    cwd: sourceRoot,
    encoding: "utf8",
  }).split("\0");
  const sourcePaths = files
    .filter(
      (path) =>
        /^packages\/[^/]+\/src\/.+\.tsx?$/u.test(path) &&
        !/\.(?:test|spec)\./u.test(path),
    )
    .map((path) => `/${path}`);
  return { commit, sourceRoot, sourcePaths };
}
