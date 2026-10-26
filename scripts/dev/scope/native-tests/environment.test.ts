import { test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

test("native service environment and missing login are isolated from host state", () => {
  execFileSync("python3", ["-B", "native_config_test.py"], {
    cwd: join(import.meta.dir, ".."),
    stdio: "pipe",
  });
});
