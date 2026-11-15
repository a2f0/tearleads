import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./softReset.testUtils";
import { alive, waitFor } from "./softResetCancel.testUtils";

// The complete orchestrator reaches maintenance; only that fake command leaves
// a real descendant. No cloud CLI, real configuration, or credentials are used.
function leftoverRun(cooperative: boolean, code: number) {
  const f = fixture();
  const script = join(f.root, "leftover.ts");
  const ready = join(f.root, "leftover.json");
  const signals = join(f.root, "signals");
  writeFileSync(
    script,
    `
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
if (process.argv.includes("--worker")) {
  process.on("SIGTERM", () => {
    appendFileSync(${JSON.stringify(signals)}, "SIGTERM\\n");
    ${cooperative ? "process.exit(0);" : ""}
  });
  writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid, leader: process.ppid }));
} else {
  Bun.spawn([process.execPath, import.meta.path, "--worker"], { stdout: "ignore", stderr: "ignore" });
  setInterval(() => { if (existsSync(${JSON.stringify(ready)})) process.exit(${code}); }, 10);
}
setInterval(() => {}, 1000);
`,
  );
  f.write(
    "packages/api/scripts/deployApiMaintenance.sh",
    `#!/bin/sh\nexec '${process.execPath}' '${script}'\n`,
  );
  for (const args of [
    ["add", "."],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--quiet",
      "-m",
      "fixture leftover",
    ],
  ]) {
    const result = Bun.spawnSync(["git", ...args], { cwd: f.repo, env: f.env });
    if (result.exitCode) throw new Error(result.stderr.toString());
  }
  const child = Bun.spawn(f.command, {
    cwd: f.repo,
    env: f.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  return {
    ...f,
    child,
    signals,
    stdout,
    stderr,
    pids: () =>
      JSON.parse(readFileSync(ready, "utf8")) as {
        pid: number;
        leader: number;
      },
    async cleanup() {
      child.kill("SIGKILL");
      if (existsSync(ready)) {
        const { leader, pid } = this.pids();
        try {
          process.kill(-leader, "SIGKILL");
        } catch {
          /* gone */
        }
        await waitFor(() => !alive(pid));
      }
      await child.exited;
      await Promise.all([stdout, stderr]);
      rmSync(f.root, { recursive: true, force: true });
    },
  };
}

test.each([
  [true, 0, "none", 1],
  [false, 7, "none", 1],
  [false, 0, "SIGINT", 130],
  [false, 0, "SIGTERM", 143],
  [false, 0, "SIGHUP", 129],
] as const)(
  "maintenance leftovers cooperative=%s exit=%s operator=%s stop every later effect",
  async (cooperative, code, signal, exitCode) => {
    const f = leftoverRun(cooperative, code);
    try {
      // Automatic cleanup has begun before the first real operator signal.
      await waitFor(() => existsSync(f.signals), 15_000);
      if (signal !== "none") {
        f.child.kill(signal);
        await Bun.sleep(20);
        f.child.kill("SIGTERM");
        await Bun.sleep(20);
        f.child.kill("SIGINT");
      }
      const outcome = await Promise.race([
        f.child.exited,
        Bun.sleep(3000).then(() => "pending"),
      ]);
      expect(outcome).toBe(exitCode);
      expect(readFileSync(f.signals, "utf8")).toBe("SIGTERM\n");
      await waitFor(() => !alive(f.pids().pid));
      const status = signal === "none" ? "failed" : "interrupted";
      const { dir, record } = f.records();
      expect(record.status).toBe(status);
      expect(record.steps.at(-1)).toMatchObject({
        label: "maintenance",
        status,
      });
      expect(record.steps.at(-1).elapsedMs).toBeGreaterThanOrEqual(1000);
      expect(existsSync(join(dir, "private"))).toBe(true);
      expect(
        existsSync(join(f.home, ".local/state/tearleads-soft-reset/prod.lock")),
      ).toBe(true);
      const later = [
        "drop-postgres-owned.sh",
        "empty-r2-bucket.sh",
        "deployApi.sh",
        "deployAppWeb.sh",
        "deployWebsite.sh",
      ];
      expect(f.calls().filter((args) => later.includes(args[0] ?? ""))).toEqual(
        [],
      );
      expect(f.calls().filter((args) => args.includes("apply"))).toEqual([]);
      expect(await f.stdout).toContain(`total\t${status}`);
      expect(await f.stderr).toContain(
        "Natural-exit descendant cleanup (command failed)",
      );
      expect(await f.stderr).toContain("do not rerun");
    } finally {
      await f.cleanup();
    }
  },
  25_000,
);
