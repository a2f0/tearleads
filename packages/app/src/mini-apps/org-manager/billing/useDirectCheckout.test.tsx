import { afterEach, expect, mock, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  capabilityWith,
  createCapturingDiagnostics,
  OPTION,
  renderFlow,
  restoreDirectCheckoutSpies,
  stubTearleads,
} from "../../../../test/helpers/directCheckoutTestKit";
import { createAppHostConfig } from "../../../host/AppHostConfig";
import { DirectCheckoutProvider } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import { LogProvider } from "../../../providers/logging/LogProvider";
import { CHECKOUT_LABELS } from "./checkoutCopy";
import { useDirectCheckoutFlow } from "./useDirectCheckout";

afterEach(restoreDirectCheckoutSpies);

test("loads the purchasable option when the platform supports checkout", async () => {
  stubTearleads();
  const { capability } = capabilityWith({});
  const { result } = renderFlow(capability);

  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(result.current.available).toBe(true);
  expect(result.current.phase.kind).toBe("idle");
});

test("begin mounts into the panel's host and tracks the form's email", async () => {
  stubTearleads();
  const { capability, mounted } = capabilityWith({});
  const { result, host } = renderFlow(capability);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => result.current.begin(OPTION));

  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(mounted[0]?.host).toBe(host);
  expect(result.current.billingEmailComplete).toBe(false);

  act(() => mounted[0]?.onBillingEmailChange("buyer@example.com"));
  expect(result.current.billingEmailComplete).toBe(true);

  act(() => mounted[0]?.onBillingEmailChange(null));
  expect(result.current.billingEmailComplete).toBe(false);
});

test("an abandoned element's email event cannot unlock Pay", async () => {
  stubTearleads();
  const { capability, mounted } = capabilityWith({});
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  act(() => result.current.cancel());

  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(mounted).toHaveLength(2));
  act(() => mounted[0]?.onBillingEmailChange("stale@example.com"));

  expect(result.current.billingEmailComplete).toBe(false);
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
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
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
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
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
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
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
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  unmountHook();

  expect(unmount).toHaveBeenCalledTimes(1);
});

test("a form that cannot mount surfaces an error and stays idle", async () => {
  stubTearleads();
  const failure = new Error("The payment form could not be loaded.");
  const { capability } = capabilityWith(
    {},
    { failMounts: 1, mountError: failure },
  );
  const { captured, diagnostics } = createCapturingDiagnostics();
  const { result } = renderFlow(capability, undefined, "org-1", diagnostics);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => result.current.begin(OPTION));

  await waitFor(() => expect(result.current.error).not.toBeNull());
  expect(result.current.phase.kind).toBe("idle");
  // The original Error reaches diagnostics, not just the generic label.
  expect(captured).toEqual([failure]);
});

test("the form opens for the offer, and only Pay starts the subscription", async () => {
  const organizations = stubTearleads();
  const { capability, mounted } = capabilityWith({});
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(mounted[0]?.price).toEqual({ amount: 99, currency: "usd" });
  expect(organizations.createStripeCheckout).not.toHaveBeenCalled();

  await act(async () => result.current.confirm());

  await waitFor(() => expect(result.current.phase.kind).toBe("idle"));
  expect(organizations.createStripeCheckout).toHaveBeenCalledWith(
    OPTION.priceId,
    "org-1",
  );
});

test("a Pay for a plan no longer offered closes the form and offers the current plans", async () => {
  const team = { ...OPTION, priceId: "price_team_5", unitAmount: 1000 };
  const reloaded = Promise.withResolvers<{ options: (typeof OPTION)[] }>();
  let loads = 0;
  const organizations = stubTearleads({
    createStripeCheckout: () =>
      Promise.reject(
        Object.assign(new Error("plan unavailable"), {
          code: "billing_checkout_plan_unavailable",
        }),
      ),
    loadStripeCheckoutOptions: () => {
      loads += 1;
      return loads === 1
        ? Promise.resolve({ options: [OPTION] })
        : reloaded.promise;
    },
  });
  const unmount = mock(() => undefined);
  const { capability, mounted } = capabilityWith({ unmount });
  const { captured, diagnostics } = createCapturingDiagnostics();
  const { result } = renderFlow(capability, undefined, "org-1", diagnostics);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  await act(async () => result.current.confirm());

  await waitFor(() => expect(result.current.phase.kind).toBe("idle"));
  expect(result.current.error).toBe(CHECKOUT_LABELS.planUnavailable);
  expect(unmount).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(organizations.loadStripeCheckoutOptions).toHaveBeenCalledTimes(2),
  );
  // While the plans reload there is no offer, so the refused one cannot be
  // opened again.
  expect(result.current.options).toEqual([]);
  await act(async () => result.current.begin(OPTION));
  expect(mounted).toHaveLength(1);

  await act(async () => reloaded.resolve({ options: [team] }));
  await waitFor(() => expect(result.current.options).toEqual([team]));
  await act(async () => result.current.begin(team));
  await waitFor(() => expect(mounted).toHaveLength(2));
  expect(mounted[1]?.price).toEqual({ amount: 1000, currency: "usd" });
  // An expected outcome, not a failure to report.
  expect(captured).toEqual([]);
});

test("switching plans re-prices the open form, and Pay starts the new plan", async () => {
  const team = { ...OPTION, priceId: "price_team_5", unitAmount: 1000 };
  const organizations = stubTearleads({
    loadStripeCheckoutOptions: () =>
      Promise.resolve({ options: [OPTION, team] }),
  });
  const { capability, prices } = capabilityWith({});
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.options).toEqual([OPTION, team]));
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  act(() => result.current.changePlan(team));

  expect(result.current.chosen).toBe(team);
  expect(prices).toEqual([{ amount: 1000, currency: "usd" }]);
  await act(async () => result.current.confirm());
  await waitFor(() => expect(result.current.phase.kind).toBe("idle"));
  expect(organizations.createStripeCheckout).toHaveBeenCalledWith(
    team.priceId,
    "org-1",
  );
});

test("a thrown confirm keeps the element mounted and is reported", async () => {
  stubTearleads();
  const failure = new Error("network dropped");
  const unmount = mock(() => undefined);
  const { capability } = capabilityWith({
    confirm: () => Promise.reject(failure),
    unmount,
  });
  const { captured, diagnostics } = createCapturingDiagnostics();
  const { result } = renderFlow(capability, undefined, "org-1", diagnostics);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  await act(async () => result.current.confirm());

  await waitFor(() => expect(result.current.error).not.toBeNull());
  expect(result.current.phase.kind).toBe("collecting");
  expect(unmount).not.toHaveBeenCalled();
  expect(captured).toEqual([failure]);
});

test("a paid checkout marks activation pending rather than a lone refresh", async () => {
  stubTearleads();
  const onPaid = mock(() => undefined);
  const { capability } = capabilityWith({
    confirm: () => Promise.resolve({ kind: "succeeded" }),
  });
  const { result } = renderFlow(capability, onPaid);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
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
      <LogProvider>
        <DirectCheckoutProvider>{children}</DirectCheckoutProvider>
      </LogProvider>
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
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  rerender({ organizationId: "org-2" });

  // The form shows org-1's plan; paying it after the switch would charge the
  // wrong organization's offer.
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
      <LogProvider>
        <DirectCheckoutProvider>{children}</DirectCheckoutProvider>
      </LogProvider>
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
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));

  // e.g. another admin's purchase lands and the org starts syncing: the panel
  // stops rendering the checkout, so its host would vanish under a live
  // session.
  rerender({ enabled: false });

  expect(unmount).toHaveBeenCalledTimes(1);
  expect(result.current.phase.kind).toBe("idle");
});

test("the checkout stays starting until the mounted form is ready", async () => {
  stubTearleads();
  const { capability, mounted } = capabilityWith({}, { formReady: false });
  const { result } = renderFlow(capability);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(mounted).toHaveLength(1));
  expect(result.current.phase.kind).toBe("starting");

  act(() => mounted[0]?.onReady());
  expect(result.current.phase.kind).toBe("collecting");
});

test("a form that fails to load unmounts its session and reports why", async () => {
  stubTearleads();
  const unmount = mock(() => undefined);
  const { capability, mounted } = capabilityWith(
    { unmount },
    { formReady: false },
  );
  const { captured, diagnostics } = createCapturingDiagnostics();
  const { result } = renderFlow(capability, undefined, "org-1", diagnostics);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await act(async () => result.current.begin(OPTION));
  await waitFor(() => expect(mounted).toHaveLength(1));
  const failure = new Error("The payment form could not be loaded.");

  act(() => mounted[0]?.onLoadError(failure));

  expect(result.current.phase.kind).toBe("idle");
  expect(result.current.error).toBe(CHECKOUT_LABELS.unavailable);
  expect(unmount).toHaveBeenCalledTimes(1);
  // The original Error reaches diagnostics, not just the generic label.
  expect(captured).toEqual([failure]);
});
