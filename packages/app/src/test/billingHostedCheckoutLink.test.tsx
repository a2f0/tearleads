import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  checkoutState,
  fakeTab,
  OPTION,
  renderWithHostedLink,
  restoreDirectCheckoutViewStubs,
  stubOpen,
  stubTearleads,
  trackSpy,
} from "../../test/helpers/directCheckoutViewKit";
import { BillingDirectCheckout } from "../mini-apps/org-manager/billing/BillingDirectCheckout";
import { CHECKOUT_LABELS } from "../mini-apps/org-manager/billing/checkoutCopy";

/** The "Pay on Stripe instead" link under the open form, for its plan. */

afterEach(restoreDirectCheckoutViewStubs);

/** An open form for the default plan, where the hosted link lives. */
const collecting = checkoutState({ phase: { kind: "collecting" } });

test("the hosted-checkout link opens Stripe's page for the plan the form shows", async () => {
  const createStripeCheckoutSession = mock(
    (_priceId: string, _returnUrl: string, _organizationId?: string) =>
      Promise.resolve({ url: "https://checkout.stripe.com/pay/x" }),
  );
  stubTearleads(createStripeCheckoutSession);
  const tab = fakeTab();
  const openMock = mock(() => tab);
  stubOpen(openMock);

  const view = renderWithHostedLink(
    <BillingDirectCheckout checkout={collecting} disabled={false} />,
  );
  fireEvent.click(view.getByText(CHECKOUT_LABELS.payOnStripe));

  await waitFor(() =>
    expect(createStripeCheckoutSession).toHaveBeenCalledTimes(1),
  );
  const [priceId, , organizationId] =
    createStripeCheckoutSession.mock.calls[0] ?? [];
  expect(priceId).toBe(OPTION.priceId);
  expect(organizationId).toBe("org-1");
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
  trackSpy(assign);

  const view = renderWithHostedLink(
    <BillingDirectCheckout checkout={collecting} disabled={false} />,
  );
  fireEvent.click(view.getByText(CHECKOUT_LABELS.payOnStripe));

  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/pay/x"),
  );
});

test("a null hosted session closes the tab and leaves the buyer on the page", async () => {
  // Unconfigured: the blank tab is closed, and the link becomes usable again
  // rather than stranding the buyer on a spinner.
  const createStripeCheckoutSession = mock(() =>
    Promise.resolve({ url: null }),
  );
  stubTearleads(createStripeCheckoutSession);
  const tab = fakeTab();
  stubOpen(() => tab);
  const assign = spyOn(globalThis.location, "assign").mockImplementation(
    () => undefined,
  );
  trackSpy(assign);

  const view = renderWithHostedLink(
    <BillingDirectCheckout checkout={collecting} disabled={false} />,
  );
  fireEvent.click(view.getByText(CHECKOUT_LABELS.payOnStripe));

  await waitFor(() =>
    expect(createStripeCheckoutSession).toHaveBeenCalledTimes(1),
  );
  expect(assign).not.toHaveBeenCalled();
  expect(tab.close).toHaveBeenCalledTimes(1);
  expect(
    view.getByText(CHECKOUT_LABELS.payOnStripe).closest("button")?.disabled,
  ).toBe(false);
  // A null result surfaces a notice rather than a silent dead click.
  await waitFor(() =>
    expect(
      view.getByText(CHECKOUT_LABELS.payOnStripeUnavailable),
    ).toBeDefined(),
  );
});

test("a refused hosted session closes the tab and surfaces the notice", async () => {
  // A rejected mint must not strand the blank tab; it is closed and the notice
  // shown, mirroring the null-result path.
  const failure = new Error("boom");
  const createStripeCheckoutSession = mock(() => Promise.reject(failure));
  const logged = stubTearleads(createStripeCheckoutSession);
  const tab = fakeTab();
  stubOpen(() => tab);

  const view = renderWithHostedLink(
    <BillingDirectCheckout checkout={collecting} disabled={false} />,
  );
  fireEvent.click(view.getByText(CHECKOUT_LABELS.payOnStripe));

  await waitFor(() => expect(tab.close).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      view.getByText(CHECKOUT_LABELS.payOnStripeUnavailable),
    ).toBeDefined(),
  );
  // The original Error reaches diagnostics, not just the notice.
  expect(logged).toEqual([
    ["Failed to open the hosted Stripe checkout", failure],
  ]);
});

test("the hosted-checkout link is not offered before a plan is chosen", () => {
  stubTearleads();
  const view = renderWithHostedLink(
    <BillingDirectCheckout checkout={checkoutState({})} disabled={false} />,
  );
  expect(view.queryByText(CHECKOUT_LABELS.payOnStripe)).toBeNull();
});

test("a hosted session for a plan no longer offered closes the form quietly", async () => {
  const refusal = Object.assign(new Error("plan unavailable"), {
    code: "billing_checkout_plan_unavailable",
  });
  const logged = stubTearleads(() => Promise.reject(refusal));
  const tab = fakeTab();
  stubOpen(() => tab);
  const planUnavailable = mock(() => undefined);

  const view = renderWithHostedLink(
    <BillingDirectCheckout
      checkout={checkoutState({
        phase: { kind: "collecting" },
        planUnavailable,
      })}
      disabled={false}
    />,
  );
  fireEvent.click(view.getByText(CHECKOUT_LABELS.payOnStripe));

  await waitFor(() => expect(planUnavailable).toHaveBeenCalledTimes(1));
  expect(tab.close).toHaveBeenCalledTimes(1);
  // Expected, so neither the notice nor diagnostics hear about it.
  expect(view.queryByText(CHECKOUT_LABELS.payOnStripeUnavailable)).toBeNull();
  expect(logged).toEqual([]);
});

test("Stripe's page is not offered while an inline payment is running", () => {
  stubTearleads();
  const view = renderWithHostedLink(
    <BillingDirectCheckout
      checkout={checkoutState({ phase: { kind: "confirming" } })}
      disabled={false}
    />,
  );
  expect(
    view.getByText(CHECKOUT_LABELS.payOnStripe).closest("button")?.disabled,
  ).toBe(true);
});

test("Pay waits while Stripe's page opens, and the form hands off to it", async () => {
  const minted = Promise.withResolvers<{ url: string | null }>();
  stubTearleads(() => minted.promise);
  stubOpen(() => fakeTab());
  const handOffToStripe = mock(() => undefined);
  const view = renderWithHostedLink(
    <BillingDirectCheckout
      checkout={checkoutState({
        billingEmailComplete: true,
        handOffToStripe,
        phase: { kind: "collecting" },
      })}
      disabled={false}
    />,
  );
  const pay = () => view.getByText(CHECKOUT_LABELS.pay).closest("button");
  expect(pay()?.disabled).toBe(false);

  fireEvent.click(view.getByText(CHECKOUT_LABELS.payOnStripe));

  expect(pay()?.disabled).toBe(true);
  minted.resolve({ url: "https://checkout.stripe.com/pay/x" });
  await waitFor(() => expect(handOffToStripe).toHaveBeenCalledTimes(1));
});
