import { mock, spyOn } from "bun:test";
import { cleanup, type RenderResult, render } from "@testing-library/react";
import { createRef, type ReactElement } from "react";
import type { DirectCheckoutState } from "../../src/mini-apps/org-manager/billing/useDirectCheckout";
import { AppFeatureFlagsProvider } from "../../src/providers/feature-flags/AppFeatureFlagsProvider";
import {
  appFeatureFlagStorageKey,
  saveAppFeatureFlag,
} from "../../src/providers/feature-flags/appFeatureFlags";
import * as LogProvider from "../../src/providers/logging/LogProvider";
import * as TearleadsProvider from "../../src/providers/sdk/TearleadsProvider";

/**
 * Fixtures for rendering `BillingDirectCheckout` from a hand-built
 * `DirectCheckoutState`. Every stub registers its restore here; call
 * {@link restoreDirectCheckoutViewStubs} after each test, since bun runs every
 * test file in one process.
 */

const spies: { mockRestore: () => void }[] = [];

const HOSTED_FLAG_KEY = appFeatureFlagStorageKey("stripe-hosted-checkout");

export function restoreDirectCheckoutViewStubs(): void {
  cleanup();
  localStorage.removeItem(HOSTED_FLAG_KEY);
  document.documentElement.removeAttribute("data-navigation-mode");
  while (spies.length > 0) {
    spies.pop()?.mockRestore();
  }
}

/** Stubs the log actions and records every `logError` call. */
function stubLog(): [string | Error, unknown][] {
  const logged: [string | Error, unknown][] = [];
  spies.push(
    spyOn(LogProvider, "useLog").mockReturnValue({
      log: () => undefined,
      logError: (message, cause) => {
        logged.push([message, cause]);
      },
    }),
  );
  return logged;
}

/** The checkout screen renders the hosted link, which reads the SDK facade and the log actions. */
export function stubTearleads(
  createStripeCheckoutSession: (
    priceId: string,
    returnUrl: string,
    organizationId?: string,
  ) => Promise<{
    url: string | null;
  } | null> = () => Promise.resolve({ url: null }),
): [string | Error, unknown][] {
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations: { createStripeCheckoutSession },
    } as never),
  );
  return stubLog();
}

/** Registers a spy made elsewhere for restoration after the test. */
export function trackSpy(spy: { mockRestore: () => void }): void {
  spies.push(spy);
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
    planUnavailable: () => undefined,
    handOffToStripe: () => undefined,
    confirm: () => undefined,
    cancel: () => undefined,
    ...overrides,
  };
}

export function fakeTab() {
  return {
    opener: {} as unknown,
    location: { href: "" },
    close: mock(() => undefined),
  };
}

/**
 * Stubs `globalThis.open` through a configurable property rather than `spyOn`,
 * which tears down the happy-dom window binding and strips `document` /
 * `location` from every later test.
 */
export function stubOpen(impl: () => unknown): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "open");
  Object.defineProperty(globalThis, "open", {
    configurable: true,
    writable: true,
    value: impl,
  });
  spies.push({
    mockRestore: () => {
      if (previous) {
        Object.defineProperty(globalThis, "open", previous);
      } else {
        Reflect.deleteProperty(globalThis, "open");
      }
    },
  });
}
