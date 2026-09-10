import { execFileSync } from "node:child_process";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

// These are templates or upstream output, not directly executable source.
const excludedScripts = new Map([
  [
    "packages/app-capacitor/android/gradlew",
    "generated Gradle wrapper maintained upstream",
  ],
  [
    "ansible/playbooks/templates/usr/local/bin/tearleads-api-cli.j2",
    "Jinja template; requires Ansible rendering",
  ],
  [
    "ansible/playbooks/templates/usr/local/bin/tearleads-blob-gc-healthcheck.j2",
    "Jinja template; requires Ansible rendering",
  ],
]);

function prefix(path: string): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    if (!fstatSync(descriptor).isFile()) return undefined;
    const buffer = Buffer.alloc(256);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, length);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" ||
        error.code === "EISDIR" ||
        error.code === "ENOTDIR")
    )
      return undefined;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function shellScriptInventory(cwd: string) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const paths = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const files = paths
    .filter((path) => {
      if (excludedScripts.has(path)) return false;
      const content = prefix(join(root, path));
      if (content === undefined) return false;
      if (path.endsWith(".sh")) return true;
      const firstLine = content.split("\n", 1)[0] ?? "";
      return /^#!.*[ /](?:sh|bash|dash|ksh|zsh|bats)(?:\s|$)/.test(firstLine);
    })
    .sort();
  return { root, files };
}
