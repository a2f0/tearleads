import { afterEach, expect, mock, test } from "bun:test";
import { act, waitFor } from "@testing-library/react";
import {
  capabilityWith,
  OPTION,
  renderFlow,
  restoreDirectCheckoutSpies,
  stubTearleads,
} from "../../../../test/helpers/directCheckoutTestKit";

afterEach(restoreDirectCheckoutSpies);

test("begin is a no-op while a session is already mounted", async () => {
  stubTearleads();
  const { capability, mounted } = capabilityWith({});
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  // A second begin would otherwise overwrite sessionRef and strand the first
  // element's iframe.
  await act(async () => result.current.begin());

  expect(mounted).toHaveLength(1);
});

test("a begin that fails after a newer one started does not disturb it", async () => {
  // The losing attempt must neither write its error onto the panel nor call
  // the shared teardown, which would cancel the attempt that replaced it.
  let rejectFirst: ((error: Error) => void) | undefined;
  let calls = 0;
  stubTearleads({
    createStripeCheckout: mock(() => {
      calls += 1;
      return calls === 1
        ? new Promise((_resolve, reject) => {
            rejectFirst = reject;
          })
        : Promise.resolve({
            subscriptionId: "sub_2",
            clientSecret: "pi_2",
          });
    }),
  });
  const unmount = mock(() => undefined);
  const { capability } = capabilityWith({ unmount });
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));

  await act(async () => result.current.begin());
  // Cancel bumps the token, then a fresh attempt succeeds.
  act(() => result.current.cancel());
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  await act(async () => {
    rejectFirst?.(new Error("stale failure"));
  });

  // The new checkout survives the stale rejection.
  expect(result.current.phase.kind).toBe("collecting");
  expect(result.current.error).toBeNull();
});

test("a double-clicked Pay confirms exactly once", async () => {
  // The Pay button disables itself while confirming, but that only lands on a
  // re-render — two clicks in one batch must not reach the provider twice.
  let settle: ((outcome: { kind: "succeeded" }) => void) | undefined;
  let confirms = 0;
  stubTearleads();
  const { capability } = capabilityWith({
    confirm: () => {
      confirms += 1;
      return new Promise((resolve) => {
        settle = resolve;
      });
    },
  });
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  act(() => {
    result.current.confirm();
    result.current.confirm();
  });
  expect(confirms).toBe(1);

  await act(async () => {
    settle?.({ kind: "succeeded" });
  });
  expect(confirms).toBe(1);
});

test("a cancelled confirmation releases the session so begin works again", async () => {
  // The web capability does not return `cancelled` today, but the contract
  // permits it; a stale sessionRef would make begin a permanent no-op.
  const unmount = mock(() => undefined);
  stubTearleads();
  const { capability, mounted } = capabilityWith({
    confirm: () => Promise.resolve({ kind: "cancelled" }),
    unmount,
  });
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  await act(async () => result.current.confirm());
  await waitFor(() => expect(result.current.phase.kind).toBe("idle"));
  expect(unmount).toHaveBeenCalledTimes(1);

  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(mounted).toHaveLength(2);
});

test("a double-clicked Subscribe starts exactly one checkout", async () => {
  // The `starting` window is before any re-render, so only a ref can stop the
  // second click from reaching the server and bumping the start token.
  let starts = 0;
  let release: ((intent: unknown) => void) | undefined;
  stubTearleads({
    createStripeCheckout: mock(() => {
      starts += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    }),
  });
  const { capability, mounted } = capabilityWith({});
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));

  act(() => {
    result.current.begin();
    result.current.begin();
  });
  expect(starts).toBe(1);

  await act(async () => {
    release?.({ subscriptionId: "sub_1", clientSecret: "pi_1" });
  });
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(mounted).toHaveLength(1);
});

test("a failed start releases the guard so the buyer can retry", async () => {
  // Without clearing `startingRef` on the failure path, the Subscribe row
  // would come back but do nothing.
  let attempts = 0;
  stubTearleads({
    createStripeCheckout: mock(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("500"))
        : Promise.resolve({ subscriptionId: "sub_1", clientSecret: "pi_1" });
    }),
  });
  const { capability } = capabilityWith({});
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));

  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.error).not.toBeNull());

  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(attempts).toBe(2);
});
