import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingDirectCheckout, formatPrice } from "./BillingDirectCheckout";
import type { DirectCheckoutState } from "./useDirectCheckout";

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  cleanup();
  while (spies.length > 0) {
    spies.pop()?.mockRestore();
  }
});

/** The idle checkout renders the hosted-link, which reads the SDK facade. */
function stubTearleads(
  createStripeCheckoutSession: () => Promise<{
    url: string | null;
  } | null> = () => Promise.resolve({ url: null }),
) {
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations: { createStripeCheckoutSession },
    } as never),
  );
}

const OPTION = {
  priceId: "price_1",
  productName: "Sync",
  currency: "usd",
  unitAmount: 99,
  interval: "month",
};

function state(overrides: Partial<DirectCheckoutState>): DirectCheckoutState {
  return {
    available: true,
    option: OPTION,
    phase: { kind: "idle" },
    error: null,
    hostRef: createRef<HTMLDivElement>(),
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
  const formatted = formatPrice(99, "usd", "month");
  expect(formatted).toContain("0.99");
  expect(formatted).toContain("/month");
});

test("formats a ZERO-decimal currency without dividing by 100", () => {
  // ¥500 is reported as 500 minor units, not 50000.
  const formatted = formatPrice(500, "jpy", "month");
  expect(formatted).toContain("500");
  expect(formatted).not.toContain("5.00");
});

test("omits the interval for a non-recurring price and handles no amount", () => {
  expect(formatPrice(99, "usd", null)).not.toContain("/");
  expect(formatPrice(null, "usd", "month")).toBe("");
});

test("a malformed currency code degrades without showing a wrong amount", () => {
  // Rendering the raw minor units would state a price 100x off for most
  // currencies; naming the currency alone is the safe degradation.
  const formatted = formatPrice(99, "notacurrency", "month");
  expect(formatted).toBe("NOTACURRENCY");
  expect(formatted).not.toContain("99");
});

test("a well-formed but unknown currency degrades the same way", () => {
  // The dangerous case: `Intl` does NOT throw on an unrecognized three-letter
  // code, it formats with 2 fraction digits. If that code were a zero-decimal
  // currency, the buyer would be shown 1/100 of the real price.
  const formatted = formatPrice(99, "xqz", "month");
  expect(formatted).toBe("XQZ");
  expect(formatted).not.toContain("0.99");
});

test("renders nothing when the platform or option is unavailable", () => {
  const view = render(
    <BillingDirectCheckout
      checkout={state({ available: false })}
      disabled={false}
    />,
  );
  expect(view.container.textContent).toBe("");

  view.rerender(
    <BillingDirectCheckout
      checkout={state({ option: null })}
      disabled={false}
    />,
  );
  expect(view.container.textContent).toBe("");
});

test("idle offers the priced subscribe row and hides the element host", () => {
  stubTearleads();
  const view = render(
    <BillingDirectCheckout checkout={state({})} disabled={false} />,
  );
  expect(view.getByText("Sync")).toBeDefined();
  expect(view.getByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeDefined();
  const host = view.container.querySelector(".org-manager-direct-checkout");
  expect(host?.hasAttribute("hidden")).toBe(true);
});

test("collecting shows Pay and Cancel over a visible element host", () => {
  let paid = 0;
  let cancelled = 0;
  const view = render(
    <BillingDirectCheckout
      checkout={state({
        phase: { kind: "collecting" },
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

test("the hosted-checkout link opens a Stripe session and navigates to it", async () => {
  const createStripeCheckoutSession = mock(() =>
    Promise.resolve({ url: "https://checkout.stripe.com/pay/x" }),
  );
  stubTearleads(createStripeCheckoutSession);
  const assign = spyOn(globalThis.location, "assign").mockImplementation(
    () => undefined,
  );
  spies.push(assign);

  const view = render(
    <BillingDirectCheckout checkout={state({})} disabled={false} />,
  );
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.billingPayOnStripe));

  await waitFor(() =>
    expect(createStripeCheckoutSession).toHaveBeenCalledTimes(1),
  );
  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/pay/x"),
  );
});

test("a null hosted session leaves the buyer on the page", async () => {
  // Unconfigured / not eligible: nothing opens, and the link becomes usable
  // again rather than stranding the buyer on a spinner.
  const createStripeCheckoutSession = mock(() =>
    Promise.resolve({ url: null }),
  );
  stubTearleads(createStripeCheckoutSession);
  const assign = spyOn(globalThis.location, "assign").mockImplementation(
    () => undefined,
  );
  spies.push(assign);

  const view = render(
    <BillingDirectCheckout checkout={state({})} disabled={false} />,
  );
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.billingPayOnStripe));

  await waitFor(() =>
    expect(createStripeCheckoutSession).toHaveBeenCalledTimes(1),
  );
  expect(assign).not.toHaveBeenCalled();
  expect(
    view.getByText(ORG_MANAGER_LABELS.billingPayOnStripe).closest("button")
      ?.disabled,
  ).toBe(false);
});

test("the hosted-checkout link is not offered once the inline flow starts", () => {
  stubTearleads();
  const view = render(
    <BillingDirectCheckout
      checkout={state({ phase: { kind: "collecting" } })}
      disabled={false}
    />,
  );
  expect(view.queryByText(ORG_MANAGER_LABELS.billingPayOnStripe)).toBeNull();
});
