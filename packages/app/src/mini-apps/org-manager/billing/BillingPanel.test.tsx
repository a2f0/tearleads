import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  restoreBillingPanelSpies,
  spies,
  stubEnvironment,
  wrapper,
  wrapperWith,
} from "../../../../test/helpers/billingPanelTestKit";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingPanel } from "./BillingPanel";

afterEach(() => {
  cleanup();
  restoreBillingPanelSpies();
});

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

test("Stripe cancellation renders from the snapshot without a management lookup", async () => {
  const loadBillingManagementUrl = mock(() =>
    Promise.reject(new Error("provider unavailable")),
  );
  stubEnvironment(true, {
    loadBillingManagementUrl,
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
  expect(loadBillingManagementUrl).not.toHaveBeenCalled();
  expect(cancelButton.classList.contains("mini-app-button")).toBe(true);
  expect(cancelButton.classList.contains("mini-app-row--button")).toBe(false);
  expect(view.queryByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeNull();
});

test("native takeover keeps Stripe cancellation when its store URL lookup fails", async () => {
  stubEnvironment(true, {
    loadBillingManagementUrl: () =>
      Promise.reject(new Error("store unavailable")),
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

test("Subscribe moves the payment form to its own screen and Cancel returns", async () => {
  stubEnvironment(false);
  const view = render(
    <BillingPanel isOrgAdmin organizationId="org-1" userId="user-1" />,
    { wrapper },
  );
  const subscribe = await view.findByRole("button", {
    name: ORG_MANAGER_LABELS.billingSubscribe,
  });
  const host = view.container.querySelector(".org-manager-direct-checkout");
  expect(view.getByText(ORG_MANAGER_LABELS.billingTitle)).toBeDefined();
  expect(view.getByText(ORG_MANAGER_LABELS.billingHistoryTitle)).toBeDefined();

  fireEvent.click(subscribe);

  // The wrapper's form never finishes loading, so the screen stays on its
  // loading panel, which keeps focus and the way back.
  const cancel = await view.findByRole("button", {
    name: ORG_MANAGER_LABELS.billingCancelCheckout,
  });
  expect(document.activeElement).toBe(cancel);
  expect(view.getByRole("status").textContent).toContain(
    ORG_MANAGER_LABELS.billingCheckoutStarting,
  );
  expect(view.queryByText(ORG_MANAGER_LABELS.billingTitle)).toBeNull();
  expect(view.queryByText(ORG_MANAGER_LABELS.billingHistoryTitle)).toBeNull();
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.billingSubscribe }),
  ).toBeNull();
  // The provider element's host is the same node, now laid out: switching
  // screens must not remount what Stripe attaches to.
  const checkoutHost = view.container.querySelector(
    ".org-manager-direct-checkout",
  );
  expect(checkoutHost).toBe(host);
  expect(checkoutHost?.hasAttribute("hidden")).toBe(false);

  fireEvent.click(cancel);

  await waitFor(() =>
    expect(view.getByText(ORG_MANAGER_LABELS.billingTitle)).toBeDefined(),
  );
  expect(
    view.queryByRole("button", {
      name: ORG_MANAGER_LABELS.billingCancelCheckout,
    }),
  ).toBeNull();
  expect(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.billingSubscribe }),
  ).toBeDefined();
});
