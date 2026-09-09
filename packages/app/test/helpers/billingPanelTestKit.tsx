import { spyOn } from "bun:test";
import type { OrganizationBillingView } from "@tearleads/client-sdk";
import type { PropsWithChildren } from "react";
import {
  createAppHostConfig,
  type OpenSubscriptionManagementFn,
} from "../../src/host/AppHostConfig";
import * as BillingProvider from "../../src/providers/billing/BillingProvider";
import { DirectCheckoutProvider } from "../../src/providers/direct-checkout/DirectCheckoutProvider";
import { AppHostConfigProvider } from "../../src/providers/host/AppHostConfigProvider";
import * as IdentityProvider from "../../src/providers/identity/IdentityProvider";
import { LogProvider } from "../../src/providers/logging/LogProvider";
import { PurchasesProvider } from "../../src/providers/purchases/PurchasesProvider";
import * as TearleadsProvider from "../../src/providers/sdk/TearleadsProvider";
import { billingFixture } from "./organizationBillingTestFixtures";

/**
 * Shared harness for the billing panel tests: stubs the billing snapshot, the
 * identity session, and the SDK facade, and builds the provider wrapper the
 * panel needs. Call {@link restoreBillingPanelSpies} from `afterEach`.
 */

export const spies: { mockRestore: () => void }[] = [];

export const OPTION = {
  tierId: "solo" as const,
  seatLimit: 1,
  priceId: "price_1",
  productName: "Sync",
  currency: "usd",
  unitAmount: 499,
  interval: "month",
  intervalCount: 1,
};

export function stubEnvironment(
  canSync: boolean,
  overrides: {
    isActive?: boolean;
    isTrialing?: boolean;
    canCancelDirectly?: boolean;
    managementUrl?: string | null;
    subscriptionSource?: "native" | "stripe" | null;
    /** Lapsed states the fixture cannot express through canSync/isActive. */
    status?: OrganizationBillingView["status"];
    loadBillingManagementUrl?: () => Promise<unknown>;
    loadStripeCheckoutOptions?: () => Promise<unknown>;
  } = {},
) {
  // Most syncing fixtures represent active billing unless marked trialing.
  const isActive = overrides.isActive ?? canSync;
  const isTrialing = overrides.isTrialing ?? false;
  const canCancelDirectly =
    overrides.canCancelDirectly ??
    (isActive && overrides.managementUrl === undefined);
  // The snapshot names the subscription's owner; the management lookup only
  // adds the link.
  const subscriptionSource =
    overrides.subscriptionSource ??
    (canCancelDirectly ? "stripe" : overrides.managementUrl ? "native" : null);
  const fixture = billingFixture(canSync, isActive, isTrialing);
  const status = overrides.status ?? fixture.view.status;
  const billing = {
    ...fixture.billing,
    status,
    subscriptionSource,
    canCancelDirectly,
  };
  const view = {
    ...fixture.view,
    isLocal: status === "local",
    needsAttention: status !== "local" && !canSync,
    status,
    subscriptionSource,
    canCancelDirectly,
  };
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
    spyOn(IdentityProvider, "useIdentity").mockReturnValue({
      persistSession: () => Promise.resolve(true),
    } as ReturnType<typeof IdentityProvider.useIdentity>),
  );
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations: {
        claimNativeSubscription: () => Promise.resolve(null),
        loadStripeCheckoutOptions:
          overrides.loadStripeCheckoutOptions ??
          (() => Promise.resolve({ options: [OPTION] })),
        loadBillingManagementUrl:
          overrides.loadBillingManagementUrl ??
          (() =>
            Promise.resolve({
              managementUrl: overrides.managementUrl ?? null,
            })),
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
          productId: "sync_solo_monthly",
          title: "Sync",
          description: "Cloud sync",
          priceLabel: "$4.99",
        },
      ]),
    purchaseSync: () => new Promise(() => undefined),
    hasActiveSyncEntitlement: () => Promise.resolve(false),
  } as never;
}

export function wrapperWith(
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

export const wrapper = wrapperWith(false);

export function restoreBillingPanelSpies(): void {
  while (spies.length > 0) {
    spies.pop()?.mockRestore();
  }
}
