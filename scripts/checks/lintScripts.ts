import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { checkArguments } from "../lib/checkRoot";
import { shellScriptInventory } from "./shellScripts";

const selected = checkArguments().root;
const { root, files } = shellScriptInventory(selected);
if (realpathSync(root) !== selected)
  throw new Error(`ShellCheck requires its own Git checkout: ${selected}`);
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
