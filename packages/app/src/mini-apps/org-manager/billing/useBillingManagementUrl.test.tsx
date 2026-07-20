import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { useBillingManagementUrl } from "./useBillingManagementUrl";

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  cleanup();
  while (spies.length > 0) {
    spies.pop()?.mockRestore();
  }
});

function stubOrganizations(organizations: Record<string, unknown>) {
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations,
    } as never),
  );
}

test("a RevenueCat-managed subscription never asks Stripe", async () => {
  const createStripePortalUrl = mock(() =>
    Promise.resolve({ portalUrl: "https://billing.stripe.com/x" }),
  );
  stubOrganizations({
    loadBillingManagementUrl: () =>
      Promise.resolve({ managementUrl: "https://rc.example/manage" }),
    createStripePortalUrl,
  });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", true));

  await waitFor(() => expect(result.current).toBe("https://rc.example/manage"));
  expect(createStripePortalUrl).not.toHaveBeenCalled();
});

test("a subscription RevenueCat does not know falls back to the Stripe portal", async () => {
  // An org that bought through the in-app card checkout has no RevenueCat
  // customer, so without this fallback it would get no manage/cancel link.
  stubOrganizations({
    loadBillingManagementUrl: () => Promise.resolve({ managementUrl: null }),
    createStripePortalUrl: () =>
      Promise.resolve({ portalUrl: "https://billing.stripe.com/session" }),
  });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", true));

  await waitFor(() =>
    expect(result.current).toBe("https://billing.stripe.com/session"),
  );
});

test("neither provider managing the subscription hides the link", async () => {
  stubOrganizations({
    loadBillingManagementUrl: () => Promise.resolve({ managementUrl: null }),
    createStripePortalUrl: () => Promise.resolve({ portalUrl: null }),
  });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", true));

  await waitFor(() => expect(result.current).toBeNull());
});

test("a failing Stripe portal lookup degrades instead of surfacing", async () => {
  // The manage link is a convenience; an error here must not break the panel.
  stubOrganizations({
    loadBillingManagementUrl: () => Promise.resolve({ managementUrl: null }),
    createStripePortalUrl: () => Promise.reject(new Error("500")),
  });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", true));

  await waitFor(() => expect(result.current).toBeNull());
});

test("a disabled hook asks neither provider", async () => {
  const loadBillingManagementUrl = mock(() =>
    Promise.resolve({ managementUrl: "https://rc.example/manage" }),
  );
  const createStripePortalUrl = mock(() =>
    Promise.resolve({ portalUrl: "https://billing.stripe.com/x" }),
  );
  stubOrganizations({ loadBillingManagementUrl, createStripePortalUrl });

  const { result } = renderHook(() => useBillingManagementUrl("org-1", false));

  expect(result.current).toBeNull();
  expect(loadBillingManagementUrl).not.toHaveBeenCalled();
  expect(createStripePortalUrl).not.toHaveBeenCalled();
});
