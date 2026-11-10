import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type {
  DirectCheckoutCapability,
  DirectCheckoutSession,
} from "@tearleads/client-sdk";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  capabilityWith,
  type MountInput,
  OPTION,
  renderFlow,
  restoreDirectCheckoutSpies,
  stubTearleads,
} from "../../../../test/helpers/directCheckoutTestKit";
import * as LogProvider from "../../../providers/logging/LogProvider";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import {
  type HostedCheckoutEvent,
  type HostedCheckoutState,
  IDLE_HOSTED_CHECKOUT,
  transitionHostedCheckout,
} from "./hostedCheckoutState";
import { useHostedCheckout } from "./useHostedCheckout";

const hostedSpies: { mockRestore: () => void }[] = [];

afterEach(() => {
  restoreDirectCheckoutSpies();
  for (const spy of hostedSpies.splice(0)) {
    spy.mockRestore();
  }
});

test("begin is a no-op while a session is already mounted", async () => {
  stubTearleads();
  const { capability, mounted } = capabilityWith({});
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  // A second begin would otherwise overwrite sessionRef and strand the first
  // element's iframe.
  await act(async () => result.current.begin(OPTION));

  expect(mounted).toHaveLength(1);
});

/**
 * A capability whose mounts each wait for the test to settle them, so a test
 * can order a stale attempt's failure after its replacement mounted.
 */
function heldMountCapability(unmount: () => void = () => undefined) {
  const mounts: PromiseWithResolvers<DirectCheckoutSession>[] = [];
  const session: DirectCheckoutSession = {
    confirm: () => Promise.resolve({ kind: "succeeded" }),
    updatePrice: () => undefined,
    unmount,
  };
  const capability: DirectCheckoutCapability = {
    isAvailable: true,
    mount: (input: MountInput) => {
      const mount = Promise.withResolvers<DirectCheckoutSession>();
      mounts.push(mount);
      input.onReady();
      return mount.promise;
    },
  };
  return { capability, mounts, session };
}

test("a begin that fails after a newer one started does not disturb it", async () => {
  // The losing attempt must neither write its error onto the panel nor call
  // the shared teardown, which would cancel the attempt that replaced it.
  stubTearleads();
  const { capability, mounts, session } = heldMountCapability();
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => result.current.begin(OPTION));
  // Cancel ends the first attempt, then a fresh attempt mounts.
  act(() => result.current.cancel());
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(mounts).toHaveLength(2));
  await act(async () => mounts[1]?.resolve(session));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  await act(async () => {
    mounts[0]?.reject(new Error("stale failure"));
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
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
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

test("an abandoned confirmation's failure cannot unlock a second Pay", async () => {
  // Regression: the failed-confirm path cleared the shared confirming guard
  // before checking whether its checkout was still current, so a stale
  // rejection let a double-clicked Pay charge the replacement checkout twice.
  const pending: PromiseWithResolvers<{ kind: "succeeded" }>[] = [];
  stubTearleads();
  const { capability } = capabilityWith({
    confirm: () => {
      const confirmation = Promise.withResolvers<{ kind: "succeeded" }>();
      pending.push(confirmation);
      return confirmation.promise;
    },
  });
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  act(() => result.current.confirm());
  act(() => result.current.cancel());
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  act(() => result.current.confirm());
  expect(pending).toHaveLength(2);

  await act(async () => {
    pending[0]?.reject(new Error("element unmounted"));
  });
  act(() => result.current.confirm());

  expect(pending).toHaveLength(2);
  expect(result.current.phase.kind).toBe("confirming");
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
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  await act(async () => result.current.confirm());
  await waitFor(() => expect(result.current.phase.kind).toBe("idle"));
  expect(unmount).toHaveBeenCalledTimes(1);

  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(mounted).toHaveLength(2);
});

test("a double-clicked Subscribe mounts exactly one checkout", async () => {
  // The `starting` window is before any re-render, so only the machine's ref
  // can stop the second click from opening a second form.
  stubTearleads();
  const { capability, mounts, session } = heldMountCapability();
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => {
    result.current.begin(OPTION);
    result.current.begin(OPTION);
  });
  await waitFor(() => expect(mounts).toHaveLength(1));

  await act(async () => mounts[0]?.resolve(session));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(mounts).toHaveLength(1);
});

test("a failed mount releases the guard so the buyer can retry", async () => {
  // Without leaving `starting` on the failure path, the Subscribe row would
  // come back but do nothing.
  stubTearleads();
  const { capability, mounted } = capabilityWith({}, { failMounts: 1 });
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.error).not.toBeNull());

  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(mounted).toHaveLength(2);
});

const OPENING: HostedCheckoutState = { status: "opening" };
const UNAVAILABLE: HostedCheckoutState = { status: "unavailable" };

test.each<[HostedCheckoutState, HostedCheckoutEvent, HostedCheckoutState]>([
  [IDLE_HOSTED_CHECKOUT, { type: "open" }, OPENING],
  [UNAVAILABLE, { type: "open" }, OPENING],
  [OPENING, { type: "opened" }, IDLE_HOSTED_CHECKOUT],
  [OPENING, { type: "declined" }, UNAVAILABLE],
  [OPENING, { type: "plan-unavailable" }, IDLE_HOSTED_CHECKOUT],
])("hosted checkout %o + %o -> %o", (state, event, next) => {
  expect(transitionHostedCheckout(state, event)).toEqual(next);
});

test.each<[HostedCheckoutState, HostedCheckoutEvent]>([
  [OPENING, { type: "open" }],
  [IDLE_HOSTED_CHECKOUT, { type: "opened" }],
  [IDLE_HOSTED_CHECKOUT, { type: "declined" }],
  [UNAVAILABLE, { type: "opened" }],
  [UNAVAILABLE, { type: "declined" }],
  [IDLE_HOSTED_CHECKOUT, { type: "plan-unavailable" }],
  [UNAVAILABLE, { type: "plan-unavailable" }],
])("hosted checkout ignores %o + %o", (state, event) => {
  // The same reference, so React skips the re-render.
  expect(transitionHostedCheckout(state, event)).toBe(state);
});

/** Stubs `globalThis.open` without `spyOn`, which breaks happy-dom's window. */
function stubOpen(impl: () => unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "open");
  Object.defineProperty(globalThis, "open", {
    configurable: true,
    writable: true,
    value: impl,
  });
  hostedSpies.push({
    mockRestore: () => {
      if (previous) {
        Object.defineProperty(globalThis, "open", previous);
      } else {
        Reflect.deleteProperty(globalThis, "open");
      }
    },
  });
}

test("two hosted-checkout clicks before a re-render mint one session", async () => {
  // The old guard read `busy` from the render that created the handler, so
  // a second click before React re-rendered minted a second Stripe session
  // and opened a second tab.
  let release: ((value: { url: string | null }) => void) | undefined;
  const createStripeCheckoutSession = mock(
    () =>
      new Promise<{ url: string | null }>((resolve) => {
        release = resolve;
      }),
  );
  hostedSpies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations: { createStripeCheckoutSession },
    } as never),
    spyOn(LogProvider, "useLog").mockReturnValue({
      log: () => undefined,
      logError: () => undefined,
    }),
  );
  const tab = { opener: {} as unknown, location: { href: "" }, close: mock() };
  const openTab = mock(() => tab);
  stubOpen(openTab);
  const { result } = renderHook(() =>
    useHostedCheckout({
      onOpened: () => undefined,
      onPlanUnavailable: () => undefined,
      organizationId: "org-1",
      priceId: OPTION.priceId,
    }),
  );

  act(() => {
    result.current.open();
    result.current.open();
  });
  expect(openTab).toHaveBeenCalledTimes(1);
  expect(createStripeCheckoutSession).toHaveBeenCalledTimes(1);
  expect(result.current.busy).toBe(true);

  await act(async () => {
    release?.({ url: null });
  });
  expect(result.current).toMatchObject({ busy: false, unavailable: true });
  expect(tab.close).toHaveBeenCalledTimes(1);
});
