import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const ownerRoot = realpathSync(resolve(import.meta.dir, "../.."));

// Standalone checks must not inspect the caller's index, worktree, or objects.
export function checkRoot(): string {
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS",
  ])
    delete process.env[name];
  return ownerRoot;
}

// A fixture may explicitly select its tree without redirecting Git hooks or
// unrelated children through an inherited environment variable.
export function checkArguments() {
  const root = checkRoot();
  const args = process.argv.slice(2);
  if (args[0] !== "--check-root") return { root, args };
  const target = args[1];
  if (!target) throw new Error("--check-root requires a directory");
  return { root: realpathSync(target), args: args.slice(2) };
}
