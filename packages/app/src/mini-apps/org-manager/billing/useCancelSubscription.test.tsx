import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { useCancelSubscription } from "./useCancelSubscription";

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  cleanup();
  while (spies.length > 0) {
    spies.pop()?.mockRestore();
  }
});

function stubCancel(cancelStripeSubscription: unknown) {
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations: { cancelStripeSubscription },
    } as never),
  );
}

test("cancelling takes two steps so one click cannot end a paid service", async () => {
  const cancelStripeSubscription = mock(() =>
    Promise.resolve({ cancelAt: 1893456000 }),
  );
  stubCancel(cancelStripeSubscription);
  const { result } = renderHook(() =>
    useCancelSubscription({ refresh: () => Promise.resolve() }),
  );

  expect(result.current.phase.kind).toBe("idle");
  act(() => result.current.ask());
  expect(result.current.phase.kind).toBe("confirming");
  // Reaching the confirm step must not have called anything yet.
  expect(cancelStripeSubscription).not.toHaveBeenCalled();

  await act(async () => result.current.confirm());
  await waitFor(() => expect(result.current.phase.kind).toBe("scheduled"));
  expect(cancelStripeSubscription).toHaveBeenCalledTimes(1);
});

test("backing out of the confirm step cancels nothing", async () => {
  const cancelStripeSubscription = mock(() =>
    Promise.resolve({ cancelAt: null }),
  );
  stubCancel(cancelStripeSubscription);
  const { result } = renderHook(() =>
    useCancelSubscription({ refresh: () => Promise.resolve() }),
  );

  act(() => result.current.ask());
  act(() => result.current.dismiss());

  expect(result.current.phase.kind).toBe("idle");
  expect(cancelStripeSubscription).not.toHaveBeenCalled();
});

test("a scheduled cancellation re-reads billing rather than assuming", async () => {
  // Access continues to period end, so `canSync` does NOT flip here — the
  // panel has to re-read to show what actually changed.
  const refresh = mock(() => Promise.resolve());
  stubCancel(() => Promise.resolve({ cancelAt: 1893456000 }));
  const { result } = renderHook(() => useCancelSubscription({ refresh }));

  act(() => result.current.ask());
  await act(async () => result.current.confirm());

  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});

test("a failed cancellation keeps the confirm step and surfaces the error", async () => {
  // Returning to idle would look like the click was lost.
  stubCancel(() => Promise.reject(new Error("500")));
  const { result } = renderHook(() =>
    useCancelSubscription({ refresh: () => Promise.resolve() }),
  );

  act(() => result.current.ask());
  await act(async () => result.current.confirm());

  await waitFor(() => expect(result.current.error).not.toBeNull());
  expect(result.current.phase.kind).toBe("confirming");
});

test("nothing cancellable reads as a failure, not a silent no-op", async () => {
  // A null result is a 404 or an unconfigured integration. The admin cannot
  // act on the difference, but a silent return to idle would look broken.
  stubCancel(() => Promise.resolve(null));
  const { result } = renderHook(() =>
    useCancelSubscription({ refresh: () => Promise.resolve() }),
  );

  act(() => result.current.ask());
  await act(async () => result.current.confirm());

  await waitFor(() => expect(result.current.error).not.toBeNull());
  expect(result.current.phase.kind).toBe("confirming");
});

test("a refresh failure after a successful cancel is not reported as a failure", async () => {
  // The cancellation already succeeded; a failing snapshot re-read (a plain
  // GET) must not revert to the confirm step and show "Could not cancel".
  const refresh = mock(() => Promise.reject(new Error("read failed")));
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations: {
        cancelStripeSubscription: () =>
          Promise.resolve({ cancelAt: 1893456000 }),
      },
    } as never),
  );
  const { result } = renderHook(() => useCancelSubscription({ refresh }));

  act(() => result.current.ask());
  await act(async () => result.current.confirm());

  await waitFor(() => expect(result.current.phase.kind).toBe("scheduled"));
  expect(result.current.error).toBeNull();
});

test("the scheduled phase carries the period-end date for display", async () => {
  stubCancel(() => Promise.resolve({ cancelAt: 1893456000 }));
  const { result } = renderHook(() =>
    useCancelSubscription({ refresh: () => Promise.resolve() }),
  );

  act(() => result.current.ask());
  await act(async () => result.current.confirm());

  await waitFor(() => expect(result.current.phase.kind).toBe("scheduled"));
  const { phase } = result.current;
  expect(phase.kind === "scheduled" && phase.cancelAt).toBe(1893456000);
});
