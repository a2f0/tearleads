import { expect, test } from "bun:test";
import type { Sample } from "./provision";
import { runExperiment, withInterruptionSignal } from "./runner";

function harness() {
  const samples: Sample[] = [];
  const states: string[] = [];
  const pauses: number[] = [];
  const controller = new AbortController();
  let calls = 0;
  let closes = 0;
  const tail = {
    events: [],
    warnings: [],
    close: async () => {
      closes++;
    },
  };
  const input: Parameters<typeof runExperiment>[0] = {
    options: { environment: "staging", samples: 3, cloudflare: true },
    runId: "run",
    samples,
    signal: controller.signal,
    save: async (status) => {
      states.push(status);
    },
    onSample: () => undefined,
  };
  const dependencies: NonNullable<Parameters<typeof runExperiment>[1]> = {
    openTail: async () => tail,
    pause: async (milliseconds) => {
      pauses.push(milliseconds);
    },
    provision: async () => {
      calls++;
      return {
        id: String(calls),
        status: "passed",
        failurePhase: null,
        startedAt: "now",
        phases: [],
        requests: [],
        localSql: { calls: 0, durationMs: 0 },
        userId: null,
        organizationId: null,
        sessionRevoked: true,
      };
    },
  };
  return {
    input,
    dependencies,
    controller,
    samples,
    states,
    pauses,
    calls: () => calls,
    closes: () => closes,
  };
}

test("complete serial runs save each sample and close the tail", async () => {
  const h = harness();
  expect(await runExperiment(h.input, h.dependencies)).toBe(true);
  expect(h.samples).toHaveLength(3);
  expect(h.states).toEqual([
    "running",
    "running",
    "running",
    "running",
    "complete",
  ]);
  expect(h.pauses).toEqual([1000, 1000]);
  expect(h.closes()).toBe(1);
});

test("a failed sample stops before another identity is created", async () => {
  const h = harness();
  const sample = h.dependencies.provision;
  h.dependencies.provision = async (input) => ({
    ...(await sample(input)),
    status: "failed",
  });
  expect(await runExperiment(h.input, h.dependencies)).toBe(false);
  expect(h.calls()).toBe(1);
  expect(h.states.at(-1)).toBe("failed");
  expect(h.pauses).toEqual([]);
  expect(h.closes()).toBe(1);
});

test("interruption returns failure and saves evidence before cleanup", async () => {
  const h = harness();
  h.input.onSample = () => h.controller.abort();
  expect(await runExperiment(h.input, h.dependencies)).toBe(false);
  expect(h.calls()).toBe(1);
  expect(h.states.at(-1)).toBe("failed");
  expect(h.closes()).toBe(1);
});

test("tail startup failure creates no account and writes failed status", async () => {
  const h = harness();
  h.dependencies.openTail = async () => {
    throw new Error("tail startup failed");
  };
  await expect(runExperiment(h.input, h.dependencies)).rejects.toThrow(
    "tail startup failed",
  );
  expect(h.calls()).toBe(0);
  expect(h.states).toEqual(["running", "failed"]);
});

test("report write failure still closes the tail and attempts a failed report", async () => {
  const h = harness();
  h.input.save = async (status) => {
    h.states.push(status);
    if (h.samples.length) throw new Error("disk full");
  };
  await expect(runExperiment(h.input, h.dependencies)).rejects.toThrow(
    "disk full",
  );
  expect(h.calls()).toBe(1);
  expect(h.closes()).toBe(1);
  expect(h.states.at(-1)).toBe("failed");
});

test("an unexpected provisioning exception still closes the tail", async () => {
  const h = harness();
  h.dependencies.provision = async () => {
    throw new Error("setup failed");
  };
  await expect(runExperiment(h.input, h.dependencies)).rejects.toThrow(
    "setup failed",
  );
  expect(h.closes()).toBe(1);
  expect(h.states.at(-1)).toBe("failed");
});

test("SIGINT aborts the run and signal handlers are removed after a report exception", async () => {
  const beforeInt = process.listenerCount("SIGINT");
  const beforeTerm = process.listenerCount("SIGTERM");
  await expect(
    withInterruptionSignal(async (signal) => {
      process.emit("SIGINT");
      expect(signal.aborted).toBe(true);
      throw new Error("report failed");
    }),
  ).rejects.toThrow("report failed");
  expect(process.listenerCount("SIGINT")).toBe(beforeInt);
  expect(process.listenerCount("SIGTERM")).toBe(beforeTerm);
});
