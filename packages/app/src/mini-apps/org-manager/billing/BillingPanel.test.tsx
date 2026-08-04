import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { billingFixture } from "../../../../test/helpers/organizationBillingTestFixtures";
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

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  cleanup();
  while (spies.length > 0) {
    spies.pop()?.mockRestore();
  }
});

const OPTION = {
  tierId: "solo" as const,
  seatLimit: 1,
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
    canCancelDirectly?: boolean;
    managementUrl?: string | null;
    subscriptionSource?: "native" | "stripe" | null;
    loadStripeCheckoutOptions?: () => Promise<unknown>;
  } = {},
) {
  // Most syncing fixtures represent active billing unless marked trialing.
  const isActive = overrides.isActive ?? canSync;
  const isTrialing = overrides.isTrialing ?? false;
  const { billing, view } = billingFixture(canSync, isActive, isTrialing);
  spies.push(
    spyOn(BillingProvider, "useOrganizationBilling").mockReturnValue({
      billing,
      error: null,
      loading: false,
      refresh: () => Promise.resolve(),
      startTrial: () => Promise.resolve(true),
      view,
    }),
  );
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations: {
        claimNativeSubscription: () => Promise.resolve(null),
        loadStripeCheckoutOptions:
          overrides.loadStripeCheckoutOptions ??
          (() => Promise.resolve({ options: [OPTION] })),
        loadBillingManagementUrl: () =>
          Promise.resolve({
            canCancelDirectly:
              overrides.canCancelDirectly ??
              (isActive && overrides.managementUrl === undefined),
            managementUrl: overrides.managementUrl ?? null,
            subscriptionSource:
              overrides.subscriptionSource ??
              (overrides.canCancelDirectly === true
                ? "stripe"
                : overrides.managementUrl
                  ? "native"
                  : null),
          }),
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
    nativeStore: isAvailable ? "test_store" : null,
    supportsEmbeddedCheckout: isAvailable,
    identify: () => Promise.resolve(),
    reset: () => Promise.resolve(),
    // A RevenueCat option whose row is indistinguishable from the direct
    // checkout's — which is exactly what made the two-row state confusing.
    listSyncOptions: () =>
      Promise.resolve([
        {
          tierId: "solo",
          seatLimit: 1,
          packageId: "monthly",
          productId: "sync_monthly",
          title: "Sync",
          description: "Cloud sync",
          priceLabel: "$4.99",
        },
      ]),
    purchaseSync: () => new Promise(() => undefined),
    hasActiveSyncEntitlement: () => Promise.resolve(false),
  } as never;
}

function wrapperWith(
  revenueCatAvailable: boolean,
  {
    directCheckoutAvailable = true,
    openSubscriptionManagement,
  }: {
    directCheckoutAvailable?: boolean;
    openSubscriptionManagement?: OpenSubscriptionManagementFn;
  } = {},
) {
  return function Wrapper({ children }: PropsWithChildren) {
    const hostConfig = createAppHostConfig({
      apiBaseUrl: "http://localhost",
      createDirectCheckout: () =>
        ({
          isAvailable: directCheckoutAvailable,
          mount: () => new Promise(() => undefined),
        }) as never,
      createPurchases: () => purchases(revenueCatAvailable),
      openSubscriptionManagement,
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

test("an org that cannot sync is offered the in-app card checkout", async () => {
  stubEnvironment(false);

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  await waitFor(() => expect(view.getByText("Sync")).toBeDefined());
  expect(view.getByText("$4.99/month")).toBeDefined();
  expect(view.getByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeDefined();
});

test("a checkout eligibility failure is visible instead of leaving a blank panel", async () => {
  stubEnvironment(false, {
    loadStripeCheckoutOptions: () => Promise.reject(new Error("409")),
  });

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  await waitFor(() =>
    expect(
      view.getByText(ORG_MANAGER_LABELS.billingCheckoutUnavailable),
    ).toBeDefined(),
  );
});

test("an unconfigured checkout stays absent without showing a failure", async () => {
  stubEnvironment(false, {
    loadStripeCheckoutOptions: () => Promise.resolve({ options: [] }),
  });

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );

  await waitFor(() => expect(view.queryByText("Sync")).toBeNull());
  expect(
    view.queryByText(ORG_MANAGER_LABELS.billingCheckoutUnavailable),
  ).toBeNull();
});

test("the direct checkout does not surface the 'purchases unavailable' notice", async () => {
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

test("direct cancellation is offered for a Stripe subscription", async () => {
  stubEnvironment(true, {
    canCancelDirectly: true,
    isActive: true,
    managementUrl: null,
  });

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
  expect(view.queryByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeNull();
});

test("native takeover keeps tier changes and Stripe cancellation", async () => {
  stubEnvironment(true, {
    canCancelDirectly: true,
    isActive: true,
    managementUrl: "https://rc.example/manage",
    subscriptionSource: "native",
  });

  const view = render(
    <BillingPanel
      isOrgAdmin
      isPersonalOrganization
      organizationId="org-1"
      userId="user-1"
    />,
    {
      wrapper: wrapperWith(true, { directCheckoutAvailable: false }),
    },
  );

  await waitFor(() => view.getByText(ORG_MANAGER_LABELS.billingDowngradePlan));
  expect(
    view.getByText(ORG_MANAGER_LABELS.billingCancelSubscription),
  ).toBeDefined();
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.billingRestore));
  expect(
    view.getByText(ORG_MANAGER_LABELS.billingSubscriptionMoveMessage),
  ).toBeDefined();
});

test("an unresolved personal organization does not flash the custom-org notice", async () => {
  stubEnvironment(false);

  const view = render(
    <BillingPanel
      isOrgAdmin
      isPersonalOrganization={null}
      organizationId="org-1"
      userId="user-1"
    />,
    { wrapper: wrapperWith(true, { directCheckoutAvailable: false }) },
  );

  await waitFor(() =>
    expect(
      view.getByText(ORG_MANAGER_LABELS.billingPurchaseUnavailable),
    ).toBeDefined(),
  );
  expect(
    view.queryByText(ORG_MANAGER_LABELS.billingCustomOrganizationWebOnly),
  ).toBeNull();
});

test("a custom organization directs native buyers to the web", async () => {
  stubEnvironment(false);

  const view = render(
    <BillingPanel
      isOrgAdmin
      isPersonalOrganization={false}
      organizationId="org-1"
      userId="user-1"
    />,
    { wrapper: wrapperWith(true, { directCheckoutAvailable: false }) },
  );

  await waitFor(() =>
    expect(
      view.getByText(ORG_MANAGER_LABELS.billingCustomOrganizationWebOnly),
    ).toBeDefined(),
  );
});

test("a web Stripe subscription can be cancelled from a native shell", async () => {
  stubEnvironment(true, {
    canCancelDirectly: true,
    isActive: true,
    managementUrl: null,
  });

  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    {
      wrapper: wrapperWith(true, { directCheckoutAvailable: false }),
    },
  );

  await waitFor(() =>
    expect(
      view.getByText(ORG_MANAGER_LABELS.billingCancelSubscription),
    ).toBeDefined(),
  );
  expect(view.queryByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeNull();
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

test("a provider-managed subscription shows Manage, not direct cancel", async () => {
  // Bought through RevenueCat (e.g. a store purchase opened on web): the org
  // is active AND resolves a provider manage link, so cancelling belongs to
  // the store, not to us. Offering inline cancel here would only 404.
  stubEnvironment(true, {
    isActive: true,
    canCancelDirectly: false,
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

test("the billing panel shows a native subscription-management failure", async () => {
  stubEnvironment(true, {
    isActive: true,
    managementUrl: "https://apps.apple.com/account/subscriptions",
  });
  const consoleError = spyOn(console, "error").mockImplementation(
    () => undefined,
  );
  spies.push(consoleError);
  const openNative = mock(() => Promise.reject(new Error("StoreKit failed")));
  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    {
      wrapper: wrapperWith(false, {
        openSubscriptionManagement: openNative,
      }),
    },
  );

  fireEvent.click(
    await view.findByRole("button", {
      name: ORG_MANAGER_LABELS.billingManageSubscription,
    }),
  );

  expect(
    await view.findByText(ORG_MANAGER_LABELS.billingManageSubscriptionFailed),
  ).toBeDefined();
});
