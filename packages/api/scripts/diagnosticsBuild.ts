import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { isSentryCommit } from "@tearleads/diagnostics/config";

export function apiDiagnosticsBuildOptions(root: string) {
  return {
    sourcemap: "linked" as const,
    define: { API_DIAGNOSTICS_BUILD: JSON.stringify(diagnosticsBuild(root)) },
  };
}

export function diagnosticsBuild(root: string) {
  const sourceRoot = resolve(root);
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
        /^packages\/(?:api|api-shared|crypto|diagnostics|encoding|loro|sqlite-instance|validators)\/src\/.+\.ts$/u.test(
          path,
        ) && !/\.(?:test|spec)\./u.test(path),
    )
    .map((path) => `/${path}`);
  return { commit, sourceRoot, sourcePaths };
}
