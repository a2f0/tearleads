import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { billingFixture } from "../../../../test/helpers/organizationBillingTestFixtures";
import { createAppHostConfig } from "../../../host/AppHostConfig";
import * as BillingProvider from "../../../providers/billing/BillingProvider";
import { DirectCheckoutProvider } from "../../../providers/direct-checkout/DirectCheckoutProvider";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import * as IdentityProvider from "../../../providers/identity/IdentityProvider";
import { LogProvider } from "../../../providers/logging/LogProvider";
import { PurchasesProvider } from "../../../providers/purchases/PurchasesProvider";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingPanel } from "./BillingPanel";

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  cleanup();
  while (spies.length > 0) spies.pop()?.mockRestore();
});

function stubTerminalBilling(status: "deleting" | "purged") {
  const fixture = billingFixture(false, false, false);
  spies.push(
    spyOn(BillingProvider, "useOrganizationBilling").mockReturnValue({
      billing: { ...fixture.billing, status },
      error: null,
      loading: false,
      refresh: () => Promise.resolve(),
      startTrial: () => Promise.resolve(false),
      view: {
        ...fixture.view,
        isLocal: false,
        needsAttention: true,
        status,
      },
    }),
  );
  spies.push(
    spyOn(IdentityProvider, "useIdentity").mockReturnValue({
      persistSession: () => Promise.resolve(true),
    } as ReturnType<typeof IdentityProvider.useIdentity>),
  );
  const loadStripeCheckoutOptions = mock(() =>
    Promise.resolve({ options: [] }),
  );
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations: {
        cancelStripeSubscription: () => Promise.resolve({ cancelAt: null }),
        claimNativeSubscription: () => Promise.resolve(null),
        loadBillingHistory: () => Promise.resolve(null),
        loadBillingManagementUrl: () =>
          Promise.resolve({
            canCancelDirectly: false,
            managementUrl: null,
            subscriptionSource: null,
          }),
        loadStripeCheckoutOptions,
      },
      session: {
        recoverPurgedOrganization: () => new Promise(() => undefined),
      },
    } as never),
  );
  return loadStripeCheckoutOptions;
}

function wrapperFor(lane: "native" | "stripe") {
  return function Wrapper({ children }: PropsWithChildren) {
    const purchasesAvailable = lane === "native";
    const hostConfig = createAppHostConfig({
      apiBaseUrl: "http://localhost",
      createDirectCheckout: () =>
        ({
          isAvailable: lane === "stripe",
          mount: () => new Promise(() => undefined),
        }) as never,
      createPurchases: () =>
        ({
          hasActiveSyncEntitlement: () => Promise.resolve(false),
          identify: () => Promise.resolve(),
          isAvailable: purchasesAvailable,
          listSyncOptions: () =>
            Promise.resolve([
              {
                description: "Cloud sync",
                packageId: "monthly",
                priceLabel: "$4.99",
                productId: "sync_solo_monthly",
                seatLimit: 1,
                tierId: "solo",
                title: "Sync",
              },
            ]),
          nativeStore: purchasesAvailable ? "test_store" : null,
          purchaseSync: () => new Promise(() => undefined),
          reset: () => Promise.resolve(),
          supportsEmbeddedCheckout: false,
        }) as never,
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

test.each([
  ["deleting", "stripe"],
  ["purged", "stripe"],
  ["deleting", "native"],
  ["purged", "native"],
] as const)("a %s org is not offered %s checkout", async (status, lane) => {
  const loadStripeCheckoutOptions = stubTerminalBilling(status);
  const view = render(
    <BillingPanel
      isOrgAdmin
      isPersonalOrganization
      organizationId="org-1"
      userId="user-1"
    />,
    { wrapper: wrapperFor(lane) },
  );

  await waitFor(() =>
    expect(
      view.getByText(
        status === "deleting"
          ? ORG_MANAGER_LABELS.billingDeleting
          : ORG_MANAGER_LABELS.billingPurged,
      ),
    ).toBeDefined(),
  );
  expect(loadStripeCheckoutOptions).not.toHaveBeenCalled();
  expect(view.queryByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeNull();
  expect(view.queryByText(ORG_MANAGER_LABELS.billingRestore)).toBeNull();
  expect(
    view.queryByText(ORG_MANAGER_LABELS.billingSubscriptionMoveMessage),
  ).toBeNull();
});
