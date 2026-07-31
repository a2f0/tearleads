import { afterEach, expect, mock, spyOn, test } from "bun:test";
import type {
  DirectCheckoutCapability,
  DirectCheckoutSession,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createAppHostConfig } from "../../../host/AppHostConfig";
import { DirectCheckoutProvider } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { useDirectCheckoutFlow } from "./useDirectCheckout";

// spyOn patches the shared module namespace; bun runs every test file in one
// process, so an unrestored spy would hand OTHER suites a stub Tearleads
// client (and fail them on a missing store). Restore after each test.
const spies: { mockRestore: () => void }[] = [];
afterEach(() => {
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
  cleanup();
});
const OPTION = {
  tierId: "solo" as const,
  seatLimit: 1,
  priceId: "price_1",
  productName: "Sync",
  currency: "usd",
  unitAmount: 99,
  interval: "month",
  intervalCount: 1,
};

function stubTearleads(overrides?: {
  createStripeCheckout?: () => Promise<unknown>;
}) {
  const organizations = {
    loadStripeCheckoutOptions: mock(() =>
      Promise.resolve({ options: [OPTION] }),
    ),
    createStripeCheckout:
      overrides?.createStripeCheckout ??
      mock(() =>
        Promise.resolve({ subscriptionId: "sub_1", clientSecret: "pi_secret" }),
      ),
  };
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations,
    } as never),
  );
  return organizations;
}

function capabilityWith(session: Partial<DirectCheckoutSession>): {
  capability: DirectCheckoutCapability;
  mounted: HTMLElement[];
} {
  const mounted: HTMLElement[] = [];
  const capability: DirectCheckoutCapability = {
    isAvailable: true,
    mount: mock((input: { host: HTMLElement }) => {
      mounted.push(input.host);
      return Promise.resolve({
        confirm:
          session.confirm ?? (() => Promise.resolve({ kind: "succeeded" })),
        unmount: session.unmount ?? (() => undefined),
      } as DirectCheckoutSession);
    }) as DirectCheckoutCapability["mount"],
  };
  return { capability, mounted };
}

function renderFlow(
  capability: DirectCheckoutCapability,
  onActivated: () => void = () => undefined,
  organizationId = "org-1",
) {
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://localhost",
    createDirectCheckout: () => capability,
    wsUrl: "ws://localhost",
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <AppHostConfigProvider value={hostConfig}>
      <DirectCheckoutProvider>{children}</DirectCheckoutProvider>
    </AppHostConfigProvider>
  );
  const rendered = renderHook(
    () =>
      useDirectCheckoutFlow({
        canSubscribe: true,
        enabled: true,
        organizationId,
        onPaid: onActivated,
      }),
    { wrapper },
  );
  // Give the hook a real host node, as the panel does via its ref.
  const host = document.createElement("div");
  document.body.appendChild(host);
  rendered.result.current.hostRef.current = host;
  return { ...rendered, host };
}

test("loads the purchasable option when the platform supports checkout", async () => {
  stubTearleads();
  const { capability } = capabilityWith({});
  const { result } = renderFlow(capability);

  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  expect(result.current.available).toBe(true);
  expect(result.current.phase.kind).toBe("idle");
});
test("begin mounts the element into the panel's host and collects input", async () => {
  stubTearleads();
  const { capability, mounted } = capabilityWith({});
  const { result, host } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));

  await act(async () => {
    result.current.begin();
  });

  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  // Mounted into OUR node — that is what makes the surrounding form styleable.
  expect(mounted).toEqual([host]);
});

test("a declined card keeps the element mounted so it can be corrected", async () => {
  stubTearleads();
  const unmount = mock(() => undefined);
  const { capability } = capabilityWith({
    confirm: () =>
      Promise.resolve({ kind: "declined", message: "Card declined." }),
    unmount,
  });
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  await act(async () => result.current.confirm());

  await waitFor(() => expect(result.current.error).toBe("Card declined."));
  expect(result.current.phase.kind).toBe("collecting");
  expect(unmount).not.toHaveBeenCalled();
});

test("a successful payment tears down and hands off to activation", async () => {
  stubTearleads();
  const unmount = mock(() => undefined);
  const onActivated = mock(() => undefined);
  const { capability } = capabilityWith({
    confirm: () => Promise.resolve({ kind: "succeeded" }),
    unmount,
  });
  const { result } = renderFlow(capability, onActivated);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  await act(async () => result.current.confirm());

  // Back to idle — the shared billing view owns the activation-pending
  // display, so the checkout does not park in a state with no exit.
  await waitFor(() => expect(result.current.phase.kind).toBe("idle"));
  expect(unmount).toHaveBeenCalledTimes(1);
  // The entitlement arrives via the webhook, so the panel must re-read billing
  // rather than assume the org can sync.
  expect(onActivated).toHaveBeenCalledTimes(1);
});

test("cancel unmounts the element and returns to idle", async () => {
  stubTearleads();
  const unmount = mock(() => undefined);
  const { capability } = capabilityWith({ unmount });
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  act(() => result.current.cancel());

  expect(unmount).toHaveBeenCalledTimes(1);
  expect(result.current.phase.kind).toBe("idle");
  expect(result.current.error).toBeNull();
});

test("unmounting the panel tears the element down", async () => {
  stubTearleads();
  const unmount = mock(() => undefined);
  const { capability } = capabilityWith({ unmount });
  const { result, unmount: unmountHook } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  unmountHook();

  expect(unmount).toHaveBeenCalledTimes(1);
});

test("a failed checkout start surfaces an error and stays idle", async () => {
  stubTearleads({
    createStripeCheckout: () => Promise.reject(new Error("500")),
  });
  const { capability } = capabilityWith({});
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));

  await act(async () => result.current.begin());

  await waitFor(() => expect(result.current.error).not.toBeNull());
  expect(result.current.phase.kind).toBe("idle");
});

test("a paid checkout marks activation pending rather than a lone refresh", async () => {
  stubTearleads();
  const onPaid = mock(() => undefined);
  const { capability } = capabilityWith({
    confirm: () => Promise.resolve({ kind: "succeeded" }),
  });
  const { result } = renderFlow(capability, onPaid);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  await act(async () => result.current.confirm());

  // The entitlement lands asynchronously via the provider webhook, so the
  // panel must poll — a single refresh would usually read the old status.
  await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1));
});

test("switching organizations tears down an in-flight checkout", async () => {
  stubTearleads();
  const unmount = mock(() => undefined);
  const { capability } = capabilityWith({ unmount });
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://localhost",
    createDirectCheckout: () => capability,
    wsUrl: "ws://localhost",
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <AppHostConfigProvider value={hostConfig}>
      <DirectCheckoutProvider>{children}</DirectCheckoutProvider>
    </AppHostConfigProvider>
  );
  const { result, rerender } = renderHook(
    ({ organizationId }: { organizationId: string }) =>
      useDirectCheckoutFlow({
        canSubscribe: true,
        enabled: true,
        organizationId,
        onPaid: () => undefined,
      }),
    { wrapper, initialProps: { organizationId: "org-1" } },
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  result.current.hostRef.current = host;
  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  rerender({ organizationId: "org-2" });

  // The client secret belongs to org-1's subscription; confirming it after
  // the switch would charge the wrong organization.
  expect(unmount).toHaveBeenCalledTimes(1);
  expect(result.current.phase.kind).toBe("idle");
});

test("disabling the checkout mid-flow tears the element down", async () => {
  stubTearleads();
  const unmount = mock(() => undefined);
  const { capability } = capabilityWith({ unmount });
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://localhost",
    createDirectCheckout: () => capability,
    wsUrl: "ws://localhost",
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <AppHostConfigProvider value={hostConfig}>
      <DirectCheckoutProvider>{children}</DirectCheckoutProvider>
    </AppHostConfigProvider>
  );
  const { result, rerender } = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useDirectCheckoutFlow({
        canSubscribe: true,
        enabled,
        organizationId: "org-1",
        onPaid: () => undefined,
      }),
    { wrapper, initialProps: { enabled: true } },
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  result.current.hostRef.current = host;
  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  // e.g. another admin's purchase lands and the org starts syncing: the panel
  // stops rendering the checkout, so its host would vanish under a live
  // session.
  rerender({ enabled: false });

  expect(unmount).toHaveBeenCalledTimes(1);
  expect(result.current.phase.kind).toBe("idle");
});

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
  const organizations = {
    loadStripeCheckoutOptions: mock(() =>
      Promise.resolve({ options: [OPTION] }),
    ),
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
  };
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations,
    } as never),
  );
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
  const organizations = {
    loadStripeCheckoutOptions: mock(() =>
      Promise.resolve({ options: [OPTION] }),
    ),
    createStripeCheckout: mock(() => {
      starts += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    }),
  };
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations,
    } as never),
  );
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
  const organizations = {
    loadStripeCheckoutOptions: mock(() =>
      Promise.resolve({ options: [OPTION] }),
    ),
    createStripeCheckout: mock(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("500"))
        : Promise.resolve({ subscriptionId: "sub_1", clientSecret: "pi_1" });
    }),
  };
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations,
    } as never),
  );
  const { capability } = capabilityWith({});
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));

  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.error).not.toBeNull());

  await act(async () => result.current.begin());
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(attempts).toBe(2);
});
