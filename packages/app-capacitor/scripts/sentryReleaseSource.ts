import { execFileSync } from "node:child_process";
import { isSentryCommit } from "@tearleads/diagnostics/config";

export function nativeSentryCommit(root: string): string {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("GIT_")) delete env[name];
  }
  const options = { cwd: root, env, encoding: "utf8" as const };
  const commit = execFileSync("git", ["rev-parse", "HEAD"], options).trim();
  const changes = execFileSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    options,
  );
  if (!isSentryCommit(commit) || changes) {
    throw new Error(
      "Sentry source-map publishing requires a clean Git checkout; commit changes before building a store release",
    );
  }
  return commit;
}
