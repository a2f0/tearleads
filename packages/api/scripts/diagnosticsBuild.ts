import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { isSentryCommit } from "@tearleads/diagnostics/config";
import { parseApiVersion } from "@tearleads/validators/operation";

export function apiDiagnosticsBuildOptions(root: string) {
  return {
    sourcemap: "linked" as const,
    define: {
      API_DIAGNOSTICS_BUILD: JSON.stringify(diagnosticsBuild(root)),
      API_BUILD_VERSION: JSON.stringify(apiBuildVersion(root)),
    },
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

/**
 * The number of commits reachable from HEAD, which the API reports in every
 * response. The default branch only gains squash-merged commits, so each deploy
 * from it counts higher than the last. A source archive has no history and a
 * shallow clone a truncated one that would count low, so both build without a
 * version rather than with a wrong one.
 */
export function apiBuildVersion(root: string): number | null {
  const sourceRoot = resolve(root);
  try {
    if (
      git(sourceRoot, ["rev-parse", "--is-shallow-repository"]).trim() !==
      "false"
    )
      return null;
    return parseApiVersion(
      git(sourceRoot, ["rev-list", "--count", "HEAD"]).trim(),
    );
  } catch {
    return null;
  }
}

function git(sourceRoot: string, args: readonly string[]): string {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("GIT_")) delete env[name];
  }
  return execFileSync("git", args, {
    cwd: sourceRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function readGitBuild(sourceRoot: string) {
  const commit = git(sourceRoot, ["rev-parse", "HEAD"]).trim();
  if (!isSentryCommit(commit))
    throw new Error("Cannot determine the API release commit");
  const files = git(sourceRoot, ["ls-files", "-z", "packages"]).split("\0");
  const sourcePaths = files
    .filter(
      (path) =>
        (/^packages\/(?:api|api-shared|crypto|diagnostics|encoding|loro|sqlite-instance|validators)\/src\/.+\.ts$/u.test(
          path,
        ) ||
          /^packages\/api\/scripts\/(?:blobGc|stripeSeatSync)\.ts$/u.test(
            path,
          )) &&
        !/\.(?:test|spec)\./u.test(path),
    )
    .map((path) => `/${path}`);
  return { commit, sourceRoot, sourcePaths };
}
