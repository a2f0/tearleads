import { expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./softReset.testUtils";

test.each([
  ["none", 1, "failed"],
  ["SIGHUP", 129, "interrupted"],
] as const)(
  "spawn error with queued signal %s retains recovery evidence",
  (signal, code, status) => {
    const f = fixture();
    try {
      const driver = join(f.root, "spawn-error.ts");
      writeFileSync(
        driver,
        `
import { ResetRun } from ${JSON.stringify(join(f.repo, "scripts/deploy/softResetRuntime.ts"))};
import { writeFileSync } from "node:fs";
const run = new ResetRun(${JSON.stringify(f.repo)}, "prod");
let success = false;
try {
  await run.step("missing-command", () => run.exec(["missing-cancel-fixture-executable"], "terraform-state"));
  writeFileSync(${JSON.stringify(join(f.root, "later-step"))}, "");
  success = true;
} catch (error) { console.error(String(error)); }
${signal === "none" ? "" : `process.kill(process.pid, ${JSON.stringify(signal)});`}
process.exitCode = await run.finish(success);
`,
      );
      const result = Bun.spawnSync([process.execPath, driver], {
        cwd: f.repo,
        env: f.env,
      });
      expect(result.exitCode, result.stderr.toString()).toBe(code);
      expect(result.stderr.toString()).toContain(
        "Could not start required command",
      );
      expect(existsSync(join(f.root, "later-step"))).toBe(false);
      expect(f.records().record.status).toBe(status);
      expect(f.records().record.steps.at(-1).status).toBe("failed");
      expect(existsSync(join(f.records().dir, "private"))).toBe(true);
      expect(
        existsSync(join(f.home, ".local/state/tearleads-soft-reset/prod.lock")),
      ).toBe(true);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
  10_000,
);
