import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isSentryCommit } from "@tearleads/diagnostics/config";

// Copied from app-capacitor rather than imported: deployment targets must not
// import one another.
export function desktopSentryCommit(root: string): string {
  // GIT_* variables could point Git at another checkout.
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("GIT_")) delete env[name];
  }
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8" });
  // Git looks above a root with no valid repository of its own; the release
  // must describe the root itself.
  const [toplevel, commit] = git("rev-parse", "--show-toplevel", "HEAD")
    .trim()
    .split("\n");
  if (toplevel !== realpathSync(root))
    throw new Error(
      "Desktop Sentry source-map publishing must run from the top level of its own Git checkout",
    );
  const changes = git(
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=normal",
  );
  if (!isSentryCommit(commit) || changes) {
    throw new Error(
      "Desktop Sentry source-map publishing requires a clean Git checkout; commit changes before building a desktop release",
    );
  }
  return commit;
}
