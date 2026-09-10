import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

export function trackedShellScripts(cwd: string): string[] {
  const paths = execFileSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  return paths
    .filter((path) => {
      if (excludedScripts.has(path)) return false;
      if (path.endsWith(".sh")) return true;
      const firstLine =
        readFileSync(join(cwd, path), "utf8").split("\n", 1)[0] ?? "";
      return /^#!.*[ /](?:sh|bash|dash|ksh|zsh|bats)(?:\s|$)/.test(firstLine);
    })
    .sort();
}
