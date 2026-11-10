import { afterEach, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import {
  OPTION,
  renderWithHostedLink,
  restoreDirectCheckoutViewStubs,
  checkoutState as state,
  stubTearleads,
  TEAM,
} from "../../../../test/helpers/directCheckoutViewKit";
import { AppFeatureFlagsProvider } from "../../../providers/feature-flags/AppFeatureFlagsProvider";
import { formatPrice } from "../../shared/billingFormatters";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingDirectCheckout } from "./BillingDirectCheckout";
import { CHECKOUT_LABELS } from "./checkoutCopy";

afterEach(restoreDirectCheckoutViewStubs);

/** An open form for the default plan. */
const collecting = state({ phase: { kind: "collecting" } });

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
        options: [],
        error: CHECKOUT_LABELS.unavailable,
      })}
      disabled={false}
    />,
  );
  expect(view.getByText(CHECKOUT_LABELS.unavailable)).toBeDefined();
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
  expect(view.queryByText(CHECKOUT_LABELS.emailHint)).toBeNull();

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
  const pay = () => view.getByRole("button", { name: CHECKOUT_LABELS.pay });
  expect(view.getByText(CHECKOUT_LABELS.emailHint)).toBeDefined();
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
      <BillingDirectCheckout checkout={collecting} disabled={false} />
    </AppFeatureFlagsProvider>,
  );
  expect(view.getByText(CHECKOUT_LABELS.pay)).toBeDefined();
  expect(view.queryByText(CHECKOUT_LABELS.payOnStripe)).toBeNull();
});

test("idle offers one Subscribe per plan, each opening that plan's form", () => {
  stubTearleads();
  const begun: unknown[] = [];
  const view = renderWithHostedLink(
    <BillingDirectCheckout
      checkout={state({
        options: [OPTION, TEAM],
        begin: (option) => {
          begun.push(option);
        },
      })}
      disabled={false}
    />,
  );

  const subscribes = view.getAllByRole("button", {
    name: ORG_MANAGER_LABELS.billingSubscribe,
  });
  expect(subscribes).toHaveLength(2);
  for (const button of subscribes) {
    expect(button.classList.contains("mini-app-button")).toBe(true);
    expect(button.classList.contains("mini-app-row--button")).toBe(false);
  }
  expect(view.getByText("Team (up to 5)")).toBeDefined();
  fireEvent.click(subscribes[1] as HTMLElement);
  expect(begun).toEqual([TEAM]);
});

test("the open form switches between the offered plans", () => {
  const changed: unknown[] = [];
  const view = render(
    <BillingDirectCheckout
      checkout={state({
        options: [OPTION, TEAM],
        phase: { kind: "collecting" },
        changePlan: (option) => {
          changed.push(option);
        },
      })}
      disabled={false}
    />,
  );

  fireEvent.click(view.getByRole("combobox", { name: CHECKOUT_LABELS.plan }));
  fireEvent.click(view.getByRole("option", { name: /Team \(up to 5\)/ }));

  expect(changed).toEqual([TEAM]);
});

test("a single plan is restated rather than offered as a choice", () => {
  const view = render(
    <BillingDirectCheckout
      checkout={state({ phase: { kind: "collecting" } })}
      disabled={false}
    />,
  );
  expect(view.getByText("Sync")).toBeDefined();
  expect(view.queryByRole("combobox")).toBeNull();
});

test("the plan cannot change while a payment is running", () => {
  const view = render(
    <BillingDirectCheckout
      checkout={state({
        options: [OPTION, TEAM],
        phase: { kind: "confirming" },
      })}
      disabled={false}
    />,
  );
  expect(
    view
      .getByRole("combobox", { name: CHECKOUT_LABELS.plan })
      .hasAttribute("disabled"),
  ).toBe(true);
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

  fireEvent.click(view.getByText(CHECKOUT_LABELS.pay));
  fireEvent.click(view.getByText(CHECKOUT_LABELS.cancel));
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
      name: CHECKOUT_LABELS.pay,
    });
    const cancel = view.getByRole("button", {
      name: CHECKOUT_LABELS.cancel,
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
  const pay = view.getByText(CHECKOUT_LABELS.paying).closest("button");
  const cancel = view.getByText(CHECKOUT_LABELS.cancel).closest("button");
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

test("a loading checkout shows a busy panel that can be left before the form appears", () => {
  const cancel = mock(() => undefined);
  const checkout = state({ phase: { kind: "starting" }, cancel });
  const view = render(
    <BillingDirectCheckout checkout={checkout} disabled={false} />,
  );
  const cancelButton = view.getByRole("button", {
    name: CHECKOUT_LABELS.cancel,
  });

  expect(view.getByRole("status").textContent).toContain(
    CHECKOUT_LABELS.starting,
  );
  expect(document.activeElement).toBe(cancelButton);
  // The form stays laid out for the provider to size, but nothing of the
  // checkout screen is offered until it is ready.
  const host = view.container.querySelector(".org-manager-direct-checkout");
  expect(host?.hasAttribute("hidden")).toBe(false);
  expect(view.queryByRole("heading", { name: "Checkout" })).toBeNull();
  expect(view.queryByRole("button", { name: "Pay and subscribe" })).toBeNull();
  fireEvent.click(cancelButton);
  expect(cancel).toHaveBeenCalledTimes(1);
});
