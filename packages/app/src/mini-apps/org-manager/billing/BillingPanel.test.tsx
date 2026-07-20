import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createAppHostConfig } from "../../../host/AppHostConfig";
import * as BillingProvider from "../../../providers/billing/BillingProvider";
import { DirectCheckoutProvider } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import { PurchasesProvider } from "../../../providers/purchases/PurchasesProvider";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingPanel } from "./BillingPanel";

/**
 * The container seam: where the in-app card checkout (issue #1654) and the
 * provider-hosted purchase flow interlock. Each half is unit-tested on its own;
 * these cover the wiring only this file owns — the render/teardown gate and
 * the cross-lock that keeps the two flows from competing.
 */

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  cleanup();
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
};

function stubEnvironment(canSync: boolean) {
  spies.push(
    spyOn(BillingProvider, "useOrganizationBilling").mockReturnValue({
      billing: null,
      error: null,
      loading: false,
      refresh: () => Promise.resolve(),
      startTrial: () => Promise.resolve(true),
      view: { canSync, isLocal: false, isTrialing: false },
    } as never),
  );
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations: {
        loadStripeCheckoutOptions: () => Promise.resolve({ options: [OPTION] }),
        loadBillingManagementUrl: () =>
          Promise.resolve({ managementUrl: null }),
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
          <DirectCheckoutProvider>{children}</DirectCheckoutProvider>
        </PurchasesProvider>
      </AppHostConfigProvider>
    );
  };
}

/** RevenueCat unavailable: the card checkout stands on its own. */
const wrapper = wrapperWith(false);

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
  expect(view.getByText("$4.99/month")).toBeDefined();
  expect(view.getByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeDefined();
});

test("an org that already syncs is not offered a second subscription", async () => {
  // The same gate also tears down a live element when it flips off, which is
  // why the panel must not render the checkout at all in this state — a
  // purchase here would be a server 409 shown as a generic failure.
  stubEnvironment(true);

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

test("cancelling is offered only for an org syncing on our own checkout", async () => {
  stubEnvironment(true);

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  await waitFor(() =>
    expect(
      view.getByText(ORG_MANAGER_LABELS.billingCancelSubscription),
    ).toBeDefined(),
  );
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
  stubEnvironment(true);

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
