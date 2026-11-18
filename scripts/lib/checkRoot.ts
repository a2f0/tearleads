import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export const checkRoot = realpathSync(resolve(import.meta.dir, "../.."));

// Standalone checks must not inspect the caller's index, worktree, or objects.
export function clearGitLocation(): void {
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  ])
    delete process.env[name];
}

if (realpathSync(".") !== checkRoot) clearGitLocation();

// A fixture may explicitly select its tree without redirecting Git hooks or
// unrelated children through an inherited environment variable.
export function checkArguments() {
  const args = process.argv.slice(2);
  if (args[0] !== "--check-root") return { root: checkRoot, args };
  const target = args[1];
  if (!target) throw new Error("--check-root requires a directory");
  clearGitLocation();
  return { root: realpathSync(target), args: args.slice(2) };
}
