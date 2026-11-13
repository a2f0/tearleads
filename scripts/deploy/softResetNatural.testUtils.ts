import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alive, waitFor } from "./softResetCancel.testUtils";
import { superviseCommand } from "./softResetProcess";
import type { InterruptPolicy } from "./softResetProcessState";

// A real owned group, not a claim about any particular CLI's daemon behavior.
// Both time reads and timer callbacks are controlled; OS delivery is awaited.
export async function naturalFixture(
  policy: InterruptPolicy,
  cooperative = false,
  code = 0,
) {
  const root = mkdtempSync(join(tmpdir(), "reset-natural-"));
  const ready = join(root, "ready.json");
  const signals = join(root, "signals");
  const script = join(root, "group.ts");
  writeFileSync(
    script,
    `
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const root = ${JSON.stringify(root)};
if (process.argv.includes("--worker")) {
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    appendFileSync(root + "/signals", signal + "\\n");
    ${cooperative ? "process.exit(0);" : ""}
  });
  writeFileSync(root + "/ready.json", JSON.stringify({ pid: process.pid, leader: process.ppid }));
  setInterval(() => { if (existsSync(root + "/release")) process.exit(0); }, 10);
} else {
  Bun.spawn([process.execPath, import.meta.path, "--worker"], { stdout: "ignore", stderr: "ignore" });
  setInterval(() => { if (existsSync(root + "/ready.json")) process.exit(${code}); }, 10);
}
`,
  );
  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: "ignore",
    env: { HOME: root, PATH: "/usr/bin:/bin" },
  });
  let now = 0;
  let tick = () => {};
  let stopped = false;
  const command = superviseCommand(child, policy, {
    now: () => now,
    every(callback) {
      tick = callback;
      return () => {
        stopped = true;
      };
    },
  });
  let outcome: { code: number | null } | { error: Error } | undefined;
  const completed = command.completed.then(
    (code) => {
      outcome = { code };
    },
    (error: Error) => {
      outcome = { error };
    },
  );
  await waitFor(() => existsSync(ready) && child.exitCode !== null);
  const { pid } = JSON.parse(readFileSync(ready, "utf8")) as { pid: number };
  // Let close callbacks run before time advances.
  await new Promise<void>((resolve) => setImmediate(resolve));
  tick();
  return {
    pid,
    command,
    outcome: () => outcome,
    stopped: () => stopped,
    signals: () => (existsSync(signals) ? readFileSync(signals, "utf8") : ""),
    release: () => writeFileSync(join(root, "release"), ""),
    async advance(time: number) {
      now = time;
      tick();
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    async cleanup() {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
      await waitFor(() => !alive(pid));
      tick();
      await completed;
      rmSync(root, { recursive: true, force: true });
    },
  };
}
