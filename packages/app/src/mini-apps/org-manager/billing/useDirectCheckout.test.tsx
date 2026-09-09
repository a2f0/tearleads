import { afterEach, expect, mock, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  capabilityWith,
  OPTION,
  renderFlow,
  restoreDirectCheckoutSpies,
  stubTearleads,
} from "../../../../test/helpers/directCheckoutTestKit";
import { createAppHostConfig } from "../../../host/AppHostConfig";
import { DirectCheckoutProvider } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import { useDirectCheckoutFlow } from "./useDirectCheckout";

afterEach(restoreDirectCheckoutSpies);

test("loads the purchasable option when the platform supports checkout", async () => {
  stubTearleads();
  const { capability } = capabilityWith({});
  const { result } = renderFlow(capability);

  await waitFor(() => expect(result.current.option).toEqual(OPTION));
  expect(result.current.available).toBe(true);
  expect(result.current.phase.kind).toBe("idle");
});

test("begin trims the email and mounts into the panel's host", async () => {
  stubTearleads();
  const { capability, mounted } = capabilityWith({});
  const { result, host } = renderFlow(capability);
  await waitFor(() => expect(result.current.option).toEqual(OPTION));

  await act(async () => {
    result.current.begin(" buyer@example.com ");
  });

  await waitFor(() => expect(result.current.phase.kind).toBe("collecting"));
  expect(mounted[0]?.host).toBe(host);
  expect(mounted[0]?.billingEmail).toBe("buyer@example.com");
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
