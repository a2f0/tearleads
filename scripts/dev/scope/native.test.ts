import { test } from "bun:test";
import { execFileSync } from "node:child_process";

test("native service environment and missing login are isolated from host state", () => {
  execFileSync("python3", ["-B", "native_config_test.py"], {
    cwd: import.meta.dir,
    stdio: "pipe",
  });
});
