import { cleanup, type RenderResult, render } from "@testing-library/react";
import { createRef, type ReactElement } from "react";
import type { DirectCheckoutState } from "../../src/mini-apps/org-manager/billing/useDirectCheckout";
import { AppFeatureFlagsProvider } from "../../src/providers/feature-flags/AppFeatureFlagsProvider";
import {
  appFeatureFlagStorageKey,
  saveAppFeatureFlag,
} from "../../src/providers/feature-flags/appFeatureFlags";

/**
 * Fixtures for rendering `BillingDirectCheckout` from a hand-built
 * `DirectCheckoutState`. Call {@link restoreDirectCheckoutView} after each
 * test, since bun runs every test file in one process.
 */

const HOSTED_FLAG_KEY = appFeatureFlagStorageKey("stripe-hosted-checkout");

export function restoreDirectCheckoutView(): void {
  cleanup();
  localStorage.removeItem(HOSTED_FLAG_KEY);
  document.documentElement.removeAttribute("data-navigation-mode");
}

export const OPTION = {
  tierId: "solo" as const,
  seatLimit: 1,
  priceId: "price_1",
  productName: "Sync",
  currency: "usd",
  unitAmount: 99,
  interval: "month",
  intervalCount: 1,
};

export const TEAM = {
  ...OPTION,
  tierId: "team_5" as const,
  seatLimit: 5,
  priceId: "price_5",
  productName: "Team (up to 5)",
  unitAmount: 999,
};

/** Renders with the "Pay on Stripe" link's feature flag switched on. */
export function renderWithHostedLink(ui: ReactElement): RenderResult {
  saveAppFeatureFlag(HOSTED_FLAG_KEY, "enabled");
  return render(<AppFeatureFlagsProvider>{ui}</AppFeatureFlagsProvider>);
}

export function checkoutState(
  overrides: Partial<DirectCheckoutState>,
): DirectCheckoutState {
  return {
    available: true,
    options: [OPTION],
    chosen: OPTION,
    organizationId: "org-1",
    phase: { kind: "idle" },
    error: null,
    hostRef: createRef<HTMLDivElement>(),
    billingEmailComplete: false,
    begin: () => undefined,
    changePlan: () => undefined,
    openStripePage: () => undefined,
    confirm: () => undefined,
    cancel: () => undefined,
    ...overrides,
  };
}
