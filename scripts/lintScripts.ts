import { spawnSync } from "node:child_process";
import { trackedShellScripts } from "./checks/shellScripts";

const files = trackedShellScripts(process.cwd());
console.log(`ShellCheck: ${files.length} tracked shell scripts`);
if (files.length > 0) {
  const result = spawnSync("shellcheck", ["--severity=info", "--", ...files], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
