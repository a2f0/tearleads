import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef, type ReactElement } from "react";
import { AppFeatureFlagsProvider } from "../../../providers/feature-flags/AppFeatureFlagsProvider";
import {
  appFeatureFlagStorageKey,
  saveAppFeatureFlag,
} from "../../../providers/feature-flags/appFeatureFlags";
import * as LogProvider from "../../../providers/logging/LogProvider";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { formatPrice } from "../../shared/billingFormatters";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingDirectCheckout } from "./BillingDirectCheckout";
import type { DirectCheckoutState } from "./useDirectCheckout";

const spies: { mockRestore: () => void }[] = [];

const HOSTED_FLAG_KEY = appFeatureFlagStorageKey("stripe-hosted-checkout");

afterEach(() => {
  cleanup();
  localStorage.removeItem(HOSTED_FLAG_KEY);
  document.documentElement.removeAttribute("data-navigation-mode");
  while (spies.length > 0) {
    spies.pop()?.mockRestore();
  }
});

/** The idle checkout renders the hosted-link, which reads the SDK facade and the log actions. */
function stubTearleads(
  createStripeCheckoutSession: (
    returnUrl: string,
    organizationId?: string,
  ) => Promise<{
    url: string | null;
  } | null> = () => Promise.resolve({ url: null }),
) {
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations: { createStripeCheckoutSession },
    } as never),
  );
  return stubLog();
}

/** Stubs the log actions and records every `logError` call. */
function stubLog() {
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

const OPTION = {
  tierId: "solo" as const,
  seatLimit: 1,
  priceId: "price_1",
  productName: "Sync",
  currency: "usd",
  unitAmount: 99,
  interval: "month",
  intervalCount: 1,
};

/** Renders with the "Pay on Stripe" link's feature flag switched on. */
function renderWithHostedLink(ui: ReactElement) {
  saveAppFeatureFlag(HOSTED_FLAG_KEY, "enabled");
  return render(<AppFeatureFlagsProvider>{ui}</AppFeatureFlagsProvider>);
}

function state(overrides: Partial<DirectCheckoutState>): DirectCheckoutState {
  return {
    available: true,
    option: OPTION,
    organizationId: "org-1",
    phase: { kind: "idle" },
    error: null,
    hostRef: createRef<HTMLDivElement>(),
    billingEmailComplete: false,
    begin: () => undefined,
    confirm: () => undefined,
    cancel: () => undefined,
    ...overrides,
  };
}

/**
 * The minor-unit conversion is the one piece of real logic in the component:
 * the provider reports amounts in minor units, and the exponent is per
 * currency — assuming 100 silently shows JPY at 1/100 of its true price.
 */

test("formats a two-decimal currency from its minor unit", () => {
  const formatted = formatPrice(99, "usd", "month", 1);
  expect(formatted).toContain("0.99");
  expect(formatted).toContain("/month");
});

test("formats a ZERO-decimal currency without dividing by 100", () => {
  // ¥500 is reported as 500 minor units, not 50000.
  const formatted = formatPrice(500, "jpy", "month", 1);
  expect(formatted).toContain("500");
  expect(formatted).not.toContain("5.00");
});

test("formats a non-recurring price and handles no amount", () => {
  expect(formatPrice(99, "usd", null, null)).not.toContain("/");
  expect(formatPrice(null, "usd", "month", 1)).toBe("");
});

test("a malformed currency code preserves the raw provider amount", () => {
  // Raw minor units are truthful even when no display exponent can be
  // verified; never invent a decimal conversion.
  const formatted = formatPrice(99, "notacurrency", "month", 1);
  expect(formatted).toBe("99 NOTACURRENCY minor units/month");
});

test("a well-formed but unknown currency uses the same raw fallback", () => {
  // The dangerous case: `Intl` does NOT throw on an unrecognized three-letter
  // code, it formats with 2 fraction digits. If that code were a zero-decimal
  // currency, the buyer would be shown 1/100 of the real price.
  const formatted = formatPrice(99, "xqz", "month", 1);
  expect(formatted).toBe("99 XQZ minor units/month");
});

test("renders nothing when the platform is unavailable", () => {
  const view = render(
    <BillingDirectCheckout
      checkout={state({ available: false })}
      disabled={false}
    />,
  );
  expect(view.container.textContent).toBe("");
});

test("surfaces an option-loading failure", () => {
  const view = render(
    <BillingDirectCheckout
      checkout={state({
        option: null,
        error: ORG_MANAGER_LABELS.billingCheckoutUnavailable,
      })}
      disabled={false}
    />,
  );
  expect(
    view.getByText(ORG_MANAGER_LABELS.billingCheckoutUnavailable),
  ).toBeDefined();
});

test("idle offers the priced subscription and hides the element host", () => {
  stubTearleads();
  const view = render(
    <BillingDirectCheckout checkout={state({})} disabled={false} />,
  );
  expect(view.getByText("Sync")).toBeDefined();
  expect(view.getByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeDefined();
  const host = view.container.querySelector(".org-manager-direct-checkout");
  expect(host?.hasAttribute("hidden")).toBe(true);
});

test("Subscribe opens the inline form without asking for an email first", () => {
  stubTearleads();
  let begun = 0;
  const view = render(
    <BillingDirectCheckout
      checkout={state({
        begin: () => {
          begun += 1;
        },
      })}
      disabled={false}
    />,
  );
  expect(view.queryByText(ORG_MANAGER_LABELS.billingEmailHint)).toBeNull();

  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.billingSubscribe }),
  );

  expect(begun).toBe(1);
});

test("Pay waits for the email in Stripe's form, with the hint under it", () => {
  const checkout = (billingEmailComplete: boolean) =>
    state({ phase: { kind: "collecting" }, billingEmailComplete });
  const view = render(
    <BillingDirectCheckout checkout={checkout(false)} disabled={false} />,
  );
  const pay = () =>
    view.getByRole("button", { name: ORG_MANAGER_LABELS.billingCheckoutPay });
  expect(view.getByText(ORG_MANAGER_LABELS.billingEmailHint)).toBeDefined();
  expect(pay().hasAttribute("disabled")).toBe(true);

  view.rerender(
    <BillingDirectCheckout checkout={checkout(true)} disabled={false} />,
  );

  expect(pay().hasAttribute("disabled")).toBe(false);
});

test("the Pay on Stripe link stays hidden while its feature flag is off", () => {
  stubTearleads();
  const view = render(
    <AppFeatureFlagsProvider>
      <BillingDirectCheckout checkout={state({})} disabled={false} />
    </AppFeatureFlagsProvider>,
  );
  expect(view.getByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeDefined();
  expect(view.queryByText(ORG_MANAGER_LABELS.billingPayOnStripe)).toBeNull();
});

test("idle checkout actions use the standard button styling", () => {
  stubTearleads();
  const view = renderWithHostedLink(
    <BillingDirectCheckout checkout={state({})} disabled={false} />,
  );

  expect(view.getAllByRole("button")).toHaveLength(2);
  for (const button of view.getAllByRole("button")) {
    expect(button.classList.contains("mini-app-button")).toBe(true);
    expect(button.classList.contains("mini-app-row--button")).toBe(false);
  }
});

test("collecting shows Pay and Cancel over a visible element host", () => {
  let paid = 0;
  let cancelled = 0;
  const view = render(
    <BillingDirectCheckout
      checkout={state({
        phase: { kind: "collecting" },
        billingEmailComplete: true,
        confirm: () => {
          paid += 1;
        },
        cancel: () => {
          cancelled += 1;
        },
      })}
      disabled={false}
    />,
  );
  const host = view.container.querySelector(".org-manager-direct-checkout");
  expect(host?.hasAttribute("hidden")).toBe(false);

  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.billingCheckoutPay));
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.billingCancelCheckout));
  expect(paid).toBe(1);
  expect(cancelled).toBe(1);
});

test.each(["windowed", "tablet", "mobile"])(
  "%s checkout actions use the standard button styling",
  (layout) => {
    document.documentElement.setAttribute(
      "data-navigation-mode",
      layout === "windowed" ? "windowed" : "routed",
    );
    const view = render(
      <BillingDirectCheckout
        checkout={state({ phase: { kind: "collecting" } })}
        disabled={false}
      />,
    );

    const actions = view.container.querySelector(".mini-app-actions");
    const pay = view.getByRole("button", {
      name: ORG_MANAGER_LABELS.billingCheckoutPay,
    });
    const cancel = view.getByRole("button", {
      name: ORG_MANAGER_LABELS.billingCancelCheckout,
    });

    expect(actions).not.toBeNull();
    expect(Array.from(actions?.children ?? [])).toEqual([cancel, pay]);
    expect(pay.classList.contains("mini-app-button")).toBe(true);
    expect(cancel.classList.contains("mini-app-button")).toBe(true);
  },
);

test("confirming locks both actions so a payment cannot be double-submitted", () => {
  const view = render(
    <BillingDirectCheckout
      checkout={state({ phase: { kind: "confirming" } })}
      disabled={false}
    />,
  );
  const pay = view
    .getByText(ORG_MANAGER_LABELS.billingCheckoutPaying)
    .closest("button");
  const cancel = view
    .getByText(ORG_MANAGER_LABELS.billingCancelCheckout)
    .closest("button");
  expect(pay?.disabled).toBe(true);
  expect(cancel?.disabled).toBe(true);
});

test("an error renders in the error tone", () => {
  const view = render(
    <BillingDirectCheckout
      checkout={state({
        phase: { kind: "collecting" },
        error: "Card declined.",
      })}
      disabled={false}
    />,
  );
  expect(view.getByText("Card declined.")).toBeDefined();
});

function fakeTab() {
  return {
    opener: {} as unknown,
    location: { href: "" },
    close: mock(() => undefined),
  };
}

/**
 * Stubs `globalThis.open` through a configurable property rather than `spyOn`,
 * which tears down the happy-dom window binding and strips `document` /
 * `location` from every later test. Restored in `afterEach` via `spies`.
 */
function stubOpen(impl: () => unknown) {
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

test("the hosted-checkout link opens the Stripe session in a new tab", async () => {
  const createStripeCheckoutSession = mock(
    (_returnUrl: string, _organizationId?: string) =>
      Promise.resolve({ url: "https://checkout.stripe.com/pay/x" }),
  );
  stubTearleads(createStripeCheckoutSession);
  const tab = fakeTab();
  const openMock = mock(() => tab);
  stubOpen(openMock);

  const view = renderWithHostedLink(
    <BillingDirectCheckout checkout={state({})} disabled={false} />,
  );
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.billingPayOnStripe));

  await waitFor(() =>
    expect(createStripeCheckoutSession).toHaveBeenCalledTimes(1),
  );
  expect(createStripeCheckoutSession.mock.calls[0]?.[1]).toBe("org-1");
  // Opened synchronously on the click (before the await), then pointed at the
  // minted URL once it resolves.
  expect(openMock).toHaveBeenCalledWith("about:blank", "_blank");
  await waitFor(() =>
    expect(tab.location.href).toBe("https://checkout.stripe.com/pay/x"),
  );
  // The child's back-reference is severed to prevent reverse tabnabbing.
  expect(tab.opener).toBeNull();
});

test("a blocked pop-up falls back to same-tab navigation", async () => {
  // No tab handle means the pop-up was blocked; navigate the current tab rather
  // than leave the click dead.
  const createStripeCheckoutSession = mock(() =>
    Promise.resolve({ url: "https://checkout.stripe.com/pay/x" }),
  );
  stubTearleads(createStripeCheckoutSession);
  stubOpen(() => null);
  const assign = spyOn(globalThis.location, "assign").mockImplementation(
    () => undefined,
  );
  spies.push(assign);

  const view = renderWithHostedLink(
    <BillingDirectCheckout checkout={state({})} disabled={false} />,
  );
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.billingPayOnStripe));

  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/pay/x"),
  );
});

test("a null hosted session closes the tab and leaves the buyer on the page", async () => {
  // Unconfigured / not eligible: the blank tab is closed, and the link becomes
  // usable again rather than stranding the buyer on a spinner.
  const createStripeCheckoutSession = mock(() =>
    Promise.resolve({ url: null }),
  );
  stubTearleads(createStripeCheckoutSession);
  const tab = fakeTab();
  stubOpen(() => tab);
  const assign = spyOn(globalThis.location, "assign").mockImplementation(
    () => undefined,
  );
  spies.push(assign);

  const view = renderWithHostedLink(
    <BillingDirectCheckout checkout={state({})} disabled={false} />,
  );
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.billingPayOnStripe));

  await waitFor(() =>
    expect(createStripeCheckoutSession).toHaveBeenCalledTimes(1),
  );
  expect(assign).not.toHaveBeenCalled();
  expect(tab.close).toHaveBeenCalledTimes(1);
  expect(
    view.getByText(ORG_MANAGER_LABELS.billingPayOnStripe).closest("button")
      ?.disabled,
  ).toBe(false);
  // A null result surfaces a notice rather than a silent dead click.
  await waitFor(() =>
    expect(
      view.getByText(ORG_MANAGER_LABELS.billingPayOnStripeUnavailable),
    ).toBeDefined(),
  );
});

test("a thrown hosted session closes the tab and surfaces the notice", async () => {
  // A rejected mint must not strand the blank tab; it is closed and the notice
  // shown, mirroring the null-result path.
  const failure = new Error("boom");
  const createStripeCheckoutSession = mock(() => Promise.reject(failure));
  const logged = stubTearleads(createStripeCheckoutSession);
  const tab = fakeTab();
  stubOpen(() => tab);

  const view = renderWithHostedLink(
    <BillingDirectCheckout checkout={state({})} disabled={false} />,
  );
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.billingPayOnStripe));

  await waitFor(() => expect(tab.close).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      view.getByText(ORG_MANAGER_LABELS.billingPayOnStripeUnavailable),
    ).toBeDefined(),
  );
  // The original Error reaches diagnostics, not just the notice.
  expect(logged).toEqual([
    ["Failed to open the hosted Stripe checkout", failure],
  ]);
});

test("the hosted-checkout link is not offered once the inline flow starts", () => {
  stubTearleads();
  const view = renderWithHostedLink(
    <BillingDirectCheckout
      checkout={state({ phase: { kind: "collecting" } })}
      disabled={false}
    />,
  );
  expect(view.queryByText(ORG_MANAGER_LABELS.billingPayOnStripe)).toBeNull();
});
