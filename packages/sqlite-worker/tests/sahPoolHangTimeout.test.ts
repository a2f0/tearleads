import { expect, test } from "bun:test";
import {
  SahPoolStepTimeoutError,
  withSahPoolStepHangTimeout,
} from "../src/sahPoolHangTimeout";

// withSahPoolStepHangTimeout wraps BOTH SAHPool handle-acquiring steps —
// installOpfsSAHPoolVfs (via installSahPoolVfsWithRetry) and reserveMinimumCapacity
// (in loadPersistentVfs). These tests exercise the helper directly so both call
// sites are covered by its contract: a hung step rejects (bounded), while a
// resolve/reject passes straight through unchanged.

test("withSahPoolStepHangTimeout rejects a never-settling step as a bounded timeout", async () => {
  const startedAt = Date.now();
  let caught: unknown;
  try {
    // A step that never resolves nor rejects — the Android hung createSyncAccessHandle.
    await withSahPoolStepHangTimeout(new Promise<never>(() => {}), 50);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(SahPoolStepTimeoutError);
  // Bounded by the timeout, not a stall.
  expect(Date.now() - startedAt).toBeLessThan(2_000);
});

test("withSahPoolStepHangTimeout passes a fast success through unchanged", async () => {
  await expect(
    withSahPoolStepHangTimeout(Promise.resolve("pool"), 1_000),
  ).resolves.toBe("pool");
});

test("withSahPoolStepHangTimeout surfaces the step's own rejection, not the timeout", async () => {
  const original = new Error("createSyncAccessHandle failed");
  let caught: unknown;
  try {
    await withSahPoolStepHangTimeout(Promise.reject(original), 1_000);
  } catch (error) {
    caught = error;
  }

  // A step that rejects fast is surfaced verbatim — the hang guard must not mask it.
  expect(caught).toBe(original);
  expect(caught).not.toBeInstanceOf(SahPoolStepTimeoutError);
});
