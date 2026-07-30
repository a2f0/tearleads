import { expect, test } from "bun:test";
import { measureAttached } from "../e2e/domMeasure";

/*
 * The retry in measureAttached only runs when a real remount races a real
 * measurement, so the e2e callers exercise it by luck rather than by design.
 * These drive both paths directly.
 *
 * Lives here rather than beside the helper because `e2e/` is Playwright's —
 * knip treats it as `*.spec.ts` entries, and this package's bun tests all live
 * in `scripts/`.
 */

const FAST = { intervalMs: 1, timeoutMs: 200 };

test("returns the first reading when the element is already attached", async () => {
  let calls = 0;
  const value = await measureAttached(
    "settled",
    async () => {
      calls += 1;
      return { width: 599 };
    },
    FAST,
  );

  expect(value).toEqual({ width: 599 });
  expect(calls).toBe(1);
});

test("retries past a detached reading and returns the attached one", async () => {
  // Two orphans, then the remounted element — the sequence a deep link produces.
  const readings: Array<{ width: number } | null> = [
    null,
    null,
    { width: 599 },
  ];
  let calls = 0;
  const value = await measureAttached(
    "remounting",
    async () => readings[calls++] ?? null,
    FAST,
  );

  expect(value).toEqual({ width: 599 });
  expect(calls).toBe(3);
});

test("gives up with the measurement's name once the timeout passes", async () => {
  let calls = 0;
  const failure = measureAttached(
    "never attaches",
    async () => {
      calls += 1;
      return null;
    },
    FAST,
  );

  // Names what was being measured, so a timeout in CI says which assertion was
  // waiting rather than only that something was.
  await expect(failure).rejects.toThrow(
    "never attaches: never measured while attached to the document within 200ms",
  );
  expect(calls).toBeGreaterThan(1);
});

test("a falsy-but-present reading is not mistaken for a detached one", async () => {
  // `0` is a legitimate measurement — only `null` means "detached".
  let calls = 0;
  const value = await measureAttached(
    "zero",
    async () => {
      calls += 1;
      return 0;
    },
    FAST,
  );

  expect(value).toBe(0);
  expect(calls).toBe(1);
});

test("gives up on a read that never settles, without waiting on Playwright", async () => {
  // The element never comes back, so `evaluate` never resolves. Bounded by this
  // helper rather than by the whole test's timeout, so the failure still names
  // the measurement.
  const started = Date.now();
  await expect(
    measureAttached("never settles", () => new Promise<null>(() => {}), FAST),
  ).rejects.toThrow(
    "never settles: never measured while attached to the document within 200ms",
  );

  expect(Date.now() - started).toBeLessThan(2000);
});

test("propagates an error the read itself throws", async () => {
  // A genuine page error is not a detached node and must not be retried away.
  await expect(
    measureAttached(
      "broken read",
      async () => {
        throw new Error("page closed");
      },
      FAST,
    ),
  ).rejects.toThrow("page closed");
});
