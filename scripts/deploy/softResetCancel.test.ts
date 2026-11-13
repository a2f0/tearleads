import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { alive, cancelFixture, waitFor } from "./softResetCancel.testUtils";

test.each([
  ["postgres", "SIGINT", 130, false],
  ["storage", "SIGTERM", 143, false],
  ["postgres", "SIGHUP", 129, true],
] as const)(
  "%s apply flushes after %s and repeated operator signals",
  async (stack, signal, exitCode, earlyExit) => {
    const f = cancelFixture(stack);
    try {
      await waitFor(() => existsSync(join(f.root, "ready.json")));
      f.child.kill(signal);
      await waitFor(() => existsSync(join(f.root, "signals")));
      f.child.kill("SIGTERM");
      await Bun.sleep(20);
      f.child.kill("SIGINT");
      if (earlyExit) {
        // A broken repeated-signal policy can already have killed the wrapper.
        // Still reach the live-descendant/state assertions in that control.
        if (alive(f.ready().wrapperPid))
          process.kill(f.ready().wrapperPid, "SIGTERM");
        await waitFor(() => !alive(f.ready().wrapperPid));
        expect(alive(f.ready().pid)).toBe(true);
      }
      expect(await f.child.exited).toBe(exitCode);
      expect(existsSync(join(f.root, "state-written"))).toBe(true);
      expect(readFileSync(join(f.root, "signals"), "utf8")).toBe("SIGINT\n");
      expect(existsSync(join(f.repo, "later-step"))).toBe(false);
      expect(f.records().record.steps.at(-1)).toMatchObject({
        label: "apply",
        status: "interrupted",
      });
      expect(f.records().record.steps.at(-1).elapsedMs).toBeGreaterThan(1500);
      expect(existsSync(join(f.records().dir, "private"))).toBe(true);
      expect(
        existsSync(join(f.home, ".local/state/tearleads-soft-reset/prod.lock")),
      ).toBe(true);
    } finally {
      await f.cleanup();
    }
  },
  12_000,
);
