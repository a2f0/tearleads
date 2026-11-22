import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useHeldSyncActivity } from "./useHeldSyncActivity";

afterEach(cleanup);

const DELAYS = { enterMs: 40, exitMs: 60 };

function wait(ms: number) {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

test("a short run never shows and a sustained one does until it settles", async () => {
  const { rerender, result } = renderHook(
    ({ active }: { active: boolean }) => useHeldSyncActivity(active, DELAYS),
    { initialProps: { active: false } },
  );
  rerender({ active: true });
  await wait(10);
  rerender({ active: false });
  await wait(80);
  expect(result.current).toBe(false);

  rerender({ active: true });
  await wait(80);
  expect(result.current).toBe(true);
  // A gap shorter than the exit delay keeps it shown.
  rerender({ active: false });
  await wait(20);
  rerender({ active: true });
  await wait(80);
  expect(result.current).toBe(true);
  rerender({ active: false });
  await wait(120);
  expect(result.current).toBe(false);
});
