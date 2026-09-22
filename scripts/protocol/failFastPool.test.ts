import { expect, test } from "bun:test";
import { runFailFastPool } from "./failFastPool";

interface Step {
  readonly id: string;
  readonly fail?: boolean;
  readonly throws?: boolean;
  readonly release: Promise<void>;
}

function released(): Promise<void> {
  return Promise.resolve();
}

/** A step that finishes only when the returned function is called. */
function gate(): {
  readonly release: Promise<void>;
  readonly open: () => void;
} {
  let open = (): void => {};
  const release = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, release };
}

function recorder() {
  const started: string[] = [];
  const finished: string[] = [];
  let inFlight = 0;
  let peak = 0;
  async function run(step: Step): Promise<string | undefined> {
    started.push(step.id);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await step.release;
      if (step.throws) {
        throw new Error(`${step.id} exploded`);
      }
      return step.fail ? `${step.id} failed` : undefined;
    } finally {
      inFlight -= 1;
      finished.push(step.id);
    }
  }
  return { finished, peak: () => peak, run, started };
}

const label = (step: Step): string => step.id;

test("runs every item when all succeed, never exceeding the parallelism", async () => {
  const log = recorder();
  const steps = ["a", "b", "c", "d", "e"].map((id) => ({
    id,
    release: released(),
  }));

  const failures = await runFailFastPool(steps, 2, log.run, label);

  expect(failures).toEqual([]);
  expect(log.started).toEqual(["a", "b", "c", "d", "e"]);
  expect(log.peak()).toBe(2);
});

test("starts nothing after a failure but lets in-flight items finish", async () => {
  const log = recorder();
  const slow = gate();
  const steps: Step[] = [
    { id: "slow", release: slow.release },
    { fail: true, id: "fails", release: released() },
    { id: "never-1", release: released() },
    { id: "never-2", release: released() },
  ];

  const pool = runFailFastPool(steps, 2, log.run, label);
  await Bun.sleep(0);
  slow.open();
  const failures = await pool;

  expect(failures).toEqual(["fails failed"]);
  expect(log.started).toEqual(["slow", "fails"]);
  expect(log.finished).toContain("slow");
});

test("records a thrown error as a failure and stops starting items", async () => {
  const log = recorder();
  const slow = gate();
  const steps: Step[] = [
    { id: "slow", release: slow.release },
    { id: "boom", release: released(), throws: true },
    { id: "never", release: released() },
  ];

  const pool = runFailFastPool(steps, 2, log.run, label);
  await Bun.sleep(0);
  slow.open();
  const failures = await pool;

  expect(failures).toEqual(["boom could not run: Error: boom exploded"]);
  expect(log.started).toEqual(["slow", "boom"]);
  expect(log.finished).toContain("slow");
});

test("reports every failure that was already in flight", async () => {
  const log = recorder();
  const first = gate();
  const second = gate();
  const steps: Step[] = [
    { fail: true, id: "first", release: first.release },
    { fail: true, id: "second", release: second.release },
    { id: "never", release: released() },
  ];

  const pool = runFailFastPool(steps, 2, log.run, label);
  first.open();
  second.open();
  const failures = await pool;

  expect(failures).toEqual(["first failed", "second failed"]);
  expect(log.started).toEqual(["first", "second"]);
});
