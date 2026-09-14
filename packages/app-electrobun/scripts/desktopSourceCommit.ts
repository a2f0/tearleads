import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function desktopSourceCommit(
  repoRoot: string,
  exportedCommit?: string,
): string {
  // Source archives have no Git directory. A checkout always uses its own HEAD,
  // even if a previous Docker build left an override in the caller's shell.
  if (!existsSync(join(repoRoot, ".git")) && exportedCommit?.trim())
    return exportedCommit.trim();
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
