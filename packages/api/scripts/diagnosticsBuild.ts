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
  try {
    return readGitBuild(sourceRoot);
  } catch {
    // Source archives can still build the API; without Git, reporting stays off.
    return { commit: "", sourceRoot, sourcePaths: [] };
  }
}

function readGitBuild(sourceRoot: string) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("GIT_")) delete env[name];
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!isSentryCommit(commit))
    throw new Error("Cannot determine the API release commit");
  const files = execFileSync("git", ["ls-files", "-z", "packages"], {
    cwd: sourceRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
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
