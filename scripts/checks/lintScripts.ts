import { spawnSync } from "node:child_process";
import { checkArguments, requireGitRoot } from "../lib/checkRoot";
import { shellScriptInventory } from "./shellScripts";

const { root, files } = shellScriptInventory(
  requireGitRoot(checkArguments().root),
);
console.log(`ShellCheck: ${files.length} tracked shell scripts`);
if (files.length === 0) {
  throw new Error("ShellCheck inventory is empty; check the working checkout.");
}
const result = spawnSync("shellcheck", ["--severity=style", "--", ...files], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
