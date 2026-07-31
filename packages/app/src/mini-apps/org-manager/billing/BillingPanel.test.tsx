import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  createAppHostConfig,
  type OpenSubscriptionManagementFn,
} from "../../../host/AppHostConfig";
import * as BillingProvider from "../../../providers/billing/BillingProvider";
import { DirectCheckoutProvider } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import { LogProvider } from "../../../providers/logging/LogProvider";
import { PurchasesProvider } from "../../../providers/purchases/PurchasesProvider";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingPanel } from "./BillingPanel";
import { useOpenSubscriptionManagement } from "./useOpenSubscriptionManagement";

/**
 * The container seam: where the in-app card checkout (issue #1654) and the
 * provider-hosted purchase flow interlock. Each half is unit-tested on its own;
 * these cover the wiring only this file owns — the render/teardown gate and
 * the cross-lock that keeps the two flows from competing.
 */

const spies: { mockRestore: () => void }[] = [];
const originalWindowOpen = window.open;

afterEach(() => {
  cleanup();
  window.open = originalWindowOpen;
  while (spies.length > 0) {
    spies.pop()?.mockRestore();
  }
});

const OPTION = {
  priceId: "price_1",
  productName: "Sync",
  currency: "usd",
  unitAmount: 499,
  interval: "month",
  intervalCount: 1,
};

function stubEnvironment(
  canSync: boolean,
  overrides: {
    isActive?: boolean;
    isTrialing?: boolean;
    managementUrl?: string | null;
  } = {},
) {
  // Default `isActive` to `canSync` for the common active case; tests that
  // exercise the trialing / provider-managed distinctions pass it explicitly.
  const isActive = overrides.isActive ?? canSync;
  const isTrialing = overrides.isTrialing ?? false;
  spies.push(
    spyOn(BillingProvider, "useOrganizationBilling").mockReturnValue({
      billing: null,
      error: null,
      loading: false,
      refresh: () => Promise.resolve(),
      startTrial: () => Promise.resolve(true),
      view: { canSync, isActive, isLocal: false, isTrialing },
    } as never),
  );
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations: {
        loadStripeCheckoutOptions: () => Promise.resolve({ options: [OPTION] }),
        loadBillingManagementUrl: () =>
          Promise.resolve({ managementUrl: overrides.managementUrl ?? null }),
        loadBillingHistory: () => Promise.resolve(null),
        cancelStripeSubscription: () => Promise.resolve({ cancelAt: null }),
      },
    } as never),
  );
}

/**
 * The real providers, so the panel exercises the same capability injection it
 * uses in production. `createPurchases` is deliberately UNAVAILABLE: the card
 * checkout must not depend on the RevenueCat capability being configured.
 */
function purchases(isAvailable: boolean) {
  return {
    isAvailable,
    supportsEmbeddedCheckout: isAvailable,
    identify: () => Promise.resolve(),
    reset: () => Promise.resolve(),
    // A RevenueCat option whose row is indistinguishable from the direct
    // checkout's — which is exactly what made the two-row state confusing.
    listSyncOptions: () =>
      Promise.resolve([
        {
          packageId: "monthly",
          productId: "sync_monthly",
          title: "Sync",
          description: "Cloud sync",
          priceLabel: "$4.99",
        },
      ]),
    purchaseSync: () => new Promise(() => undefined),
    restore: () => Promise.resolve(),
    hasActiveSyncEntitlement: () => Promise.resolve(false),
  } as never;
}

function wrapperWith(revenueCatAvailable: boolean) {
  return function Wrapper({ children }: PropsWithChildren) {
    const hostConfig = createAppHostConfig({
      apiBaseUrl: "http://localhost",
      createDirectCheckout: () =>
        ({
          isAvailable: true,
          mount: () => new Promise(() => undefined),
        }) as never,
      createPurchases: () => purchases(revenueCatAvailable),
      wsUrl: "ws://localhost",
    });
    return (
      <AppHostConfigProvider value={hostConfig}>
        <PurchasesProvider>
          <LogProvider>
            <DirectCheckoutProvider>{children}</DirectCheckoutProvider>
          </LogProvider>
        </PurchasesProvider>
      </AppHostConfigProvider>
    );
  };
}

/** RevenueCat unavailable: the card checkout stands on its own. */
const wrapper = wrapperWith(false);

function renderManagementHook(
  openSubscriptionManagement?: OpenSubscriptionManagementFn,
) {
  const onNativeManagementClosed = mock(() => undefined);
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://localhost",
    openSubscriptionManagement,
    wsUrl: "ws://localhost",
  });
  function ManagementWrapper({ children }: PropsWithChildren) {
    return (
      <AppHostConfigProvider value={hostConfig}>
        {children}
      </AppHostConfigProvider>
    );
  }
  const hook = renderHook(
    () => useOpenSubscriptionManagement(onNativeManagementClosed),
    { wrapper: ManagementWrapper },
  );
  return { ...hook, onNativeManagementClosed };
}

test("an org that cannot sync is offered the in-app card checkout", async () => {
  stubEnvironment(false);

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  // The price row proves the option loaded and the gate let it render. It
  // renders even though the RevenueCat capability is unavailable, which is the
  // point: this checkout runs on our own Stripe account.
  await waitFor(() => expect(view.getByText("Sync")).toBeDefined());
  expect(view.getByText("$4.99/seat/month")).toBeDefined();
  expect(view.getByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeDefined();
});

test("the direct checkout does not surface the 'purchases unavailable' notice", async () => {
  // Regression: gating the RC subscribe list off (to avoid two Subscribe rows)
  // must NOT trip BillingView's fallback notice. With a Stripe key present the
  // checkout IS the purchase path, so "Purchases aren't available right now" is
  // wrong — this shipped in #1679 and showed on every staging load.
  //
  // RevenueCat AVAILABLE so `purchaseAvailable` is only turned off by the
  // direct-checkout gate, which is the exact path that regressed.
  stubEnvironment(false);

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper: wrapperWith(true) },
  );

  await waitFor(() => expect(view.getByText("Sync")).toBeDefined());
  expect(
    view.queryByText(ORG_MANAGER_LABELS.billingPurchaseUnavailable),
  ).toBeNull();
});

test("an active org is not offered a second subscription", async () => {
  // `isActive` (not a trial): a second checkout would create a second Stripe
  // subscription — a server 409 shown as a generic failure — so the panel must
  // not render the checkout at all. The same gate also tears a live element
  // down when the payment lands and the org becomes active.
  stubEnvironment(true, { isActive: true });

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  await waitFor(() => expect(view.queryByText("Sync")).toBeNull());
  expect(view.queryByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeNull();
});

test("a non-admin is never offered the checkout", async () => {
  stubEnvironment(false);

  const view = render(
    <BillingPanel isOrgAdmin={false} organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  await waitFor(() => expect(view.queryByText("Sync")).toBeNull());
});

test("a signed-out user is never offered the checkout", async () => {
  // `canSubscribe` folds in the user id: without one there is no buyer.
  stubEnvironment(false);

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId={null} />,
    { wrapper },
  );

  await waitFor(() => expect(view.queryByText("Sync")).toBeNull());
});

test("the card checkout replaces RevenueCat's subscribe list, not adds to it", async () => {
  // Regression guard for the two-row state: both flows offer a "Sync /
  // Subscribe" row, and rendering both put two near-identical buttons in the
  // panel — clicking the top one gave the old unstyled hosted form.
  //
  // RevenueCat is AVAILABLE here on purpose: with it unavailable its list
  // would not render anyway and this test would pass without proving the gate.
  stubEnvironment(false);

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper: wrapperWith(true) },
  );

  await waitFor(() =>
    expect(view.getAllByText(ORG_MANAGER_LABELS.billingSubscribe)).toHaveLength(
      1,
    ),
  );
});

test("cancelling is offered for an active org with no provider-managed link", async () => {
  // A Stripe-direct subscription: active, and RevenueCat resolves no manage
  // URL because there is no RC customer.
  stubEnvironment(true, { isActive: true, managementUrl: null });

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  const cancelButton = await waitFor(() =>
    view.getByRole("button", {
      name: ORG_MANAGER_LABELS.billingCancelSubscription,
    }),
  );
  expect(cancelButton.classList.contains("mini-app-button")).toBe(true);
  expect(cancelButton.classList.contains("mini-app-row--button")).toBe(false);
});

test("a trialing org can pay before the trial ends", async () => {
  // A trial is a local status with no subscription yet, so the admin may want
  // to commit early. The checkout is offered (gate is `isActive`, not the
  // trial-inclusive `canSync`), and the server allows it.
  stubEnvironment(true, { isActive: false, isTrialing: true });

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  await waitFor(() => expect(view.getByText("Sync")).toBeDefined());
  expect(view.getByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeDefined();
});

test("a trialing org is offered the checkout but no inline cancel", async () => {
  // It can subscribe (above), but there is no subscription to cancel yet — the
  // cancel gate stays on `isActive`, so no Cancel button that could only 404.
  stubEnvironment(true, { isActive: false, isTrialing: true });

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  await waitFor(() => expect(view.getByText("Sync")).toBeDefined());
  expect(
    view.queryByText(ORG_MANAGER_LABELS.billingCancelSubscription),
  ).toBeNull();
});

test("a provider-managed subscription shows Manage, not inline cancel", async () => {
  // Bought through RevenueCat (e.g. a store purchase opened on web): the org
  // is active AND resolves a provider manage link, so cancelling belongs to
  // the store, not to us. Offering inline cancel here would only 404.
  stubEnvironment(true, {
    isActive: true,
    managementUrl: "https://rc.example/manage",
  });

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  await waitFor(() =>
    expect(
      view.getByText(ORG_MANAGER_LABELS.billingManageSubscription),
    ).toBeDefined(),
  );
  expect(
    view.queryByText(ORG_MANAGER_LABELS.billingCancelSubscription),
  ).toBeNull();
});

test("an org that is not syncing is offered nothing to cancel", async () => {
  stubEnvironment(false);

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  await waitFor(() => expect(view.getByText("Sync")).toBeDefined());
  expect(
    view.queryByText(ORG_MANAGER_LABELS.billingCancelSubscription),
  ).toBeNull();
});

test("a non-admin cannot cancel", async () => {
  stubEnvironment(true, { isActive: true, managementUrl: null });

  const view = render(
    <BillingPanel isOrgAdmin={false} organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  await waitFor(() =>
    expect(
      view.queryByText(ORG_MANAGER_LABELS.billingCancelSubscription),
    ).toBeNull(),
  );
});

test("subscription management opens the provider URL without a native host", () => {
  const opened = mock(() => null);
  window.open = opened as typeof window.open;
  const { result, onNativeManagementClosed } = renderManagementHook();
  const url = "https://apps.apple.com/account/subscriptions";

  result.current(url);

  expect(opened).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
  expect(onNativeManagementClosed).not.toHaveBeenCalled();
});

test("subscription management refreshes after the native sheet closes", async () => {
  const opened = mock(() => null);
  window.open = opened as typeof window.open;
  const openNative = mock(() => Promise.resolve());
  const { result, onNativeManagementClosed } = renderManagementHook(openNative);
  const url = "https://apps.apple.com/account/subscriptions";

  result.current(url);

  expect(openNative).toHaveBeenCalledWith(url);
  await waitFor(() =>
    expect(onNativeManagementClosed).toHaveBeenCalledTimes(1),
  );
  expect(opened).not.toHaveBeenCalled();
});

test("subscription management falls back when the native sheet fails", async () => {
  const opened = mock(() => null);
  window.open = opened as typeof window.open;
  const nativeError = new Error("StoreKit unavailable");
  const openNative = mock(() => Promise.reject(nativeError));
  const consoleError = spyOn(console, "error").mockImplementation(
    () => undefined,
  );
  spies.push(consoleError);
  const { result, onNativeManagementClosed } = renderManagementHook(openNative);
  const url = "https://apps.apple.com/account/subscriptions";

  result.current(url);

  await waitFor(() =>
    expect(opened).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer"),
  );
  expect(consoleError).toHaveBeenCalledWith(
    "Failed to open subscription management:",
    nativeError,
  );
  expect(onNativeManagementClosed).not.toHaveBeenCalled();
});
