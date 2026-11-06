import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Dependency and build output, and dot directories, never hold sources. */
function isSkippedEntryName(name: string): boolean {
  return name === "node_modules" || name === "dist" || name.startsWith(".");
}

/** Every matching file under `root`, sorted; symbolic links are not followed. */
export function walkFiles(
  root: string,
  matches: (path: string) => boolean,
): string[] {
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      break;
    }
    for (const name of readdirSync(directory)) {
      if (isSkippedEntryName(name)) {
        continue;
      }
      const path = join(directory, name);
      const entry = lstatSync(path);
      // lstat never reports a symbolic link as a directory.
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (!entry.isSymbolicLink() && matches(path)) {
        found.push(path);
      }
    }
  }
  return found.sort();
}

export function readSourceFiles(
  paths: readonly string[],
): { readonly content: string; readonly path: string }[] {
  return paths.map((path) => ({
    content: readFileSync(path, "utf8"),
    path,
  }));
}
