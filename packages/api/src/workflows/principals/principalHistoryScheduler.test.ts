import { expect, test } from "bun:test";
import { createPrincipalHistoryScheduler } from "./principalHistoryScheduler";

function scheduler(overrides = {}) {
  return createPrincipalHistoryScheduler({
    concurrency: 2,
    maximumQueued: 8,
    maximumQueuedPerPrincipal: 2,
    queueTimeoutMs: 1_000,
    ...overrides,
  });
}

test("one principal cannot occupy both workers or overtake another waiting principal", async () => {
  const schedule = scheduler();
  const started: string[] = [];
  const a = Promise.withResolvers<void>();
  const b = Promise.withResolvers<void>();
  const cStarted = Promise.withResolvers<void>();
  const first = schedule("a", async () => {
    started.push("a1");
    await a.promise;
  });
  const second = schedule("a", async () => {
    started.push("a2");
  });
  const third = schedule("b", async () => {
    started.push("b1");
    await b.promise;
  });
  const fourth = schedule("c", async () => {
    started.push("c1");
    cStarted.resolve();
  });
  expect(started).toEqual(["a1", "b1"]);
  b.resolve();
  await cStarted.promise;
  expect(started).toEqual(["a1", "b1", "c1"]);
  a.resolve();
  await Promise.all([first, second, third, fourth]);
  expect(started).toEqual(["a1", "b1", "c1", "a2"]);
});

test("a principal returns to the back after each scheduled page", async () => {
  const schedule = scheduler({ concurrency: 1 });
  const gate = Promise.withResolvers<void>();
  const held = schedule("busy", () => gate.promise);
  const started: string[] = [];
  const pending = ["a", "a", "b", "b"].map((key) =>
    schedule(key, async () => {
      started.push(key);
    }),
  );
  gate.resolve();
  await Promise.all([held, ...pending]);
  expect(started).toEqual(["a", "b", "a", "b"]);
});

test("per-principal and total waiting limits reject before invoking work", async () => {
  const schedule = scheduler({ concurrency: 1, maximumQueued: 3 });
  const gate = Promise.withResolvers<void>();
  const held = schedule("a", () => gate.promise);
  const pending = ["a", "a"].map((key) => schedule(key, async () => key));
  let called = false;
  try {
    for (const key of ["a", "c"]) {
      if (key === "c") pending.push(schedule("b", async () => "b"));
      let refusal: unknown;
      const rejected = schedule(key, async () => {
        called = true;
      }).catch((error: unknown) => {
        refusal = error;
      });
      // Capacity refusal is immediate, not a later queue-timeout rejection.
      await Promise.resolve();
      expect(refusal).toMatchObject({ status: 503 });
      await rejected;
    }
    expect(called).toBe(false);
  } finally {
    gate.resolve();
    await Promise.all([held, ...pending]);
  }
  expect(await schedule("c", async () => "recovered")).toBe("recovered");
});

test("expired waiting work never runs after capacity becomes available", async () => {
  const schedule = scheduler({ concurrency: 1, queueTimeoutMs: 20 });
  const gate = Promise.withResolvers<void>();
  const held = schedule("a", () => gate.promise);
  let called = false;
  await expect(
    schedule("b", async () => {
      called = true;
    }),
  ).rejects.toMatchObject({ status: 503 });
  gate.resolve();
  await held;
  expect(await schedule("b", async () => "new page")).toBe("new page");
  expect(called).toBe(false);
});

test("a rejected page releases capacity and preserves its original error", async () => {
  const schedule = scheduler({ concurrency: 1 });
  const failure = new Error("invalid signed history");
  const failed = schedule("a", async () => {
    throw failure;
  });
  const next = schedule("b", async () => 42);
  await expect(failed).rejects.toBe(failure);
  expect(await next).toBe(42);
});
