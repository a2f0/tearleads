import { spawnSync } from "node:child_process";
import { shellScriptInventory } from "./checks/shellScripts";

const { root, files } = shellScriptInventory(process.cwd());
console.log(`ShellCheck: ${files.length} tracked shell scripts`);
if (files.length > 0) {
  const result = spawnSync("shellcheck", ["--severity=info", "--", ...files], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
