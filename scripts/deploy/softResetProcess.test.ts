import { expect, test } from "bun:test";
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
import {
  interruptPolicies,
  type ProcessState,
  transitionProcess,
} from "./softResetProcessState";

test("fixed Terraform deadline survives repeated interrupts and wrapper close", () => {
  // Widen the literals so guard-removal controls reach runtime assertions,
  // rather than failing TypeScript's literal-sensitive toEqual overload.
  expect(String(interruptPolicies["terraform-state"].signal)).toBe("SIGINT");
  expect(Number(interruptPolicies["terraform-state"].graceMs)).toBe(60_000);
  expect(String(interruptPolicies["bounded-command"].signal)).toBe("SIGTERM");
  expect(Number(interruptPolicies["bounded-command"].graceMs)).toBe(1000);
  const start: ProcessState = { status: "running" };
  const interrupt = { type: "interrupt", now: 500 } as const;
  const draining = transitionProcess(start, interrupt, "terraform-state");
  expect(draining).toEqual({
    status: "draining",
    reason: "interrupted",
    deadline: 60_500,
  });
  const observe = (now: number, groupAlive = true) =>
    ({ type: "observe", now, leaderClosed: true, groupAlive }) as const;
  expect(
    transitionProcess(draining, { ...interrupt, now: 9000 }, "terraform-state"),
  ).toBe(draining);
  expect(transitionProcess(draining, observe(60_499), "terraform-state")).toBe(
    draining,
  );
  const forcing = transitionProcess(
    draining,
    observe(60_500),
    "terraform-state",
  );
  expect(forcing).toEqual({
    status: "forcing",
    reason: "interrupted",
    deadline: 61_500,
  });
  expect(transitionProcess(forcing, interrupt, "terraform-state")).toBe(
    forcing,
  );
  expect(transitionProcess(forcing, observe(61_499), "terraform-state")).toBe(
    forcing,
  );
  const settled = transitionProcess(
    forcing,
    observe(61_500),
    "terraform-state",
  );
  expect(settled).toEqual({ status: "settled", reason: "interrupted" });
  expect(transitionProcess(settled, interrupt, "terraform-state")).toBe(
    settled,
  );
  expect(
    transitionProcess(draining, observe(900, false), "terraform-state"),
  ).toEqual({ status: "settled", reason: "interrupted" });
  expect(
    transitionProcess(forcing, observe(60_501, false), "terraform-state"),
  ).toEqual({ status: "settled", reason: "interrupted" });
  expect(transitionProcess(start, observe(501), "terraform-state")).toEqual({
    status: "observing",
    deadline: 1501,
  });
  expect(
    transitionProcess(start, observe(501, false), "terraform-state"),
  ).toEqual({ status: "settled", reason: "natural" });
});

test.each(["after", "before"] as const)(
  "forced timeout kills descendants; wrapper exited %s interrupt",
  async (exitOrder) => {
    const exitBeforeInterrupt = exitOrder === "before";
    const root = mkdtempSync(join(tmpdir(), "reset-forced-"));
    const script = join(root, "group.ts");
    const ready = join(root, "ready.json");
    writeFileSync(
      script,
      `
import { writeFileSync } from "node:fs";
if (process.argv.includes("--worker")) {
  process.on("SIGINT", () => {});
  writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid, wrapper: process.ppid }));
} else {
  process.on("SIGINT", () => process.exit(0));
  Bun.spawn([process.execPath, import.meta.path, "--worker"], { stdout: "ignore", stderr: "ignore" });
  ${exitBeforeInterrupt ? "setTimeout(() => process.exit(0), 100);" : ""}
}
setInterval(() => {}, 100);
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
    const command = superviseCommand(child, "terraform-state", {
      now: () => now,
      every(callback) {
        tick = callback;
        return () => {
          stopped = true;
        };
      },
    });
    let settled = false;
    const completed = command.completed.then(() => {
      settled = true;
    });
    let pid: number | undefined;
    try {
      await waitFor(() => existsSync(ready));
      const record = JSON.parse(readFileSync(ready, "utf8"));
      pid = record.pid;
      if (exitBeforeInterrupt) {
        await waitFor(() => !alive(record.wrapper));
        expect(settled).toBe(false);
      }
      command.interrupt();
      await waitFor(() => !alive(record.wrapper));
      expect(alive(record.pid)).toBe(true);
      expect(settled).toBe(false);
      now = 59_999;
      tick();
      command.interrupt();
      expect(alive(record.pid)).toBe(true);
      expect(settled).toBe(false);
      now = 60_000;
      tick();
      // Keep the intended survivor assertion visible in a guard-removal control.
      await waitFor(() => !alive(record.pid), 1000).catch(() => {});
      expect(alive(record.pid)).toBe(false);
      tick();
      await completed;
      expect(stopped).toBe(true);
    } finally {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }
      const workerPid = pid;
      if (workerPid) await waitFor(() => !alive(workerPid));
      now = 61_000;
      tick();
      await completed;
      rmSync(root, { recursive: true, force: true });
    }
  },
  10_000,
);
