import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { checkRoot } from "../lib/checkRoot";
import { resolveTlcTools, tlcParallelism } from "../protocol/tlcTools";

const [task, ...extra] = process.argv.slice(2);
if (
  extra.length ||
  (task !== "check:protocol-models" &&
    task !== "check:protocol-negative-controls")
)
  throw new Error("Expected a cacheable protocol check");

// Validate the installed Java and jar even on a hit. Direct check commands
// and local check:fast still execute TLC; only CI's models job uses this wrapper.
const root = checkRoot();
const tools = resolveTlcTools(root);
tlcParallelism();
const java = spawnSync(tools.javaBin, ["-version"], { encoding: "utf8" });
if (java.status !== 0) throw new Error("Could not identify the Java runtime");
const child = Bun.spawn(
  [process.execPath, "scripts/testing/runVerifiedTurbo.ts", task],
  {
    cwd: root,
    env: {
      ...process.env,
      JAVA_BIN: tools.javaBin,
      TLA_TOOLS_ROOT: dirname(tools.jarPath),
      TLC_JAVA_RUNTIME: `${java.stdout}${java.stderr}`.trim(),
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exitCode = await child.exited;
