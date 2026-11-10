import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { BILLING_ERROR_CODES } from "@tearleads/validators/billing";
import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { billingFixture } from "../../test/helpers/organizationBillingTestFixtures";
import { BillingStripePlanSwitcher } from "../mini-apps/org-manager/billing/BillingPlanSwitcher";
import { PLAN_CHANGE_LABELS } from "../mini-apps/org-manager/billing/checkoutCopy";
import { ORG_MANAGER_LABELS } from "../mini-apps/org-manager/labels";
import * as LogProvider from "../providers/logging/LogProvider";
import * as TearleadsProvider from "../providers/sdk/TearleadsProvider";

/**
 * Changing an active Stripe subscription's plan from the billing panel: an
 * upgrade is confirmed as a charge now, a downgrade as a change at renewal.
 */

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
  cleanup();
});

const TEAM_5: StripeSyncOptionResponse = {
  currency: "usd",
  interval: "month",
  intervalCount: 1,
  priceId: "price_team_5",
  productName: "Team 5",
  seatLimit: 5,
  tierId: "team_5",
  unitAmount: 1_000,
};
const SOLO: StripeSyncOptionResponse = {
  ...TEAM_5,
  priceId: "price_sync",
  productName: "Solo",
  seatLimit: 1,
  tierId: "solo",
  unitAmount: 500,
};
const TEAM_10: StripeSyncOptionResponse = {
  ...TEAM_5,
  priceId: "price_team_10",
  productName: "Team 10",
  seatLimit: 10,
  tierId: "team_10",
  unitAmount: 2_000,
};

function stubSdk(changeStripePlan: (priceId: string) => Promise<unknown>) {
  const organizations = {
    changeStripePlan: mock(
      (priceId: string, _currentSeatCount: number, _organizationId: string) =>
        changeStripePlan(priceId),
    ),
    loadStripeCheckoutOptions: mock(() =>
      Promise.resolve({ options: [SOLO, TEAM_5, TEAM_10] }),
    ),
  };
  const logError = mock(() => undefined);
  spies.push(
    spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
      organizations,
    } as never),
    spyOn(LogProvider, "useLog").mockReturnValue({
      log: () => undefined,
      logError,
    }),
  );
  return { logError, organizations };
}

/** A Team 5 Stripe subscription, optionally renewing at a smaller plan. */
function renderSwitcher(pendingSeatCount: number | null = null) {
  const { billing, view } = billingFixture(true, true, false);
  const refresh = mock(() => Promise.resolve());
  const ui = render(
    <BillingStripePlanSwitcher
      billing={{ billing, refresh, view: { ...view, pendingSeatCount } }}
      disabled={false}
      organizationId="org-1"
    />,
  );
  const button = (row: string) =>
    ui
      .getByText(row)
      .closest(".mini-app-row")
      ?.querySelector("button") as HTMLButtonElement;
  return { button, refresh, ui };
}

test("each plan offers what choosing it does", async () => {
  stubSdk(() => Promise.resolve("upgraded"));
  const { button, ui } = renderSwitcher();
  await waitFor(() => expect(ui.getByText("Team 10")).toBeTruthy());

  expect(ui.getByText(PLAN_CHANGE_LABELS.timing)).toBeTruthy();
  expect(button("Solo").textContent).toBe(
    ORG_MANAGER_LABELS.billingDowngradePlan,
  );
  expect(button("Team 5")).toMatchObject({
    disabled: true,
    textContent: ORG_MANAGER_LABELS.billingCurrentPlan,
  });
  expect(button("Team 10").textContent).toBe(
    ORG_MANAGER_LABELS.billingUpgradePlan,
  );
});

test("an upgrade is confirmed as a charge now, then applied", async () => {
  const { organizations } = stubSdk(() => Promise.resolve("upgraded"));
  const { button, refresh, ui } = renderSwitcher();
  await waitFor(() => expect(ui.getByText("Team 10")).toBeTruthy());

  act(() => button("Team 10").click());
  expect(
    ui.getByText(PLAN_CHANGE_LABELS.upgradeNotice("Team 10")),
  ).toBeTruthy();
  expect(organizations.changeStripePlan).not.toHaveBeenCalled();
  await act(async () =>
    ui.getByText(PLAN_CHANGE_LABELS.confirmUpgrade).click(),
  );

  // Sent with the plan the admin saw, so a plan that changed meanwhile is
  // refused rather than charged differently.
  expect(organizations.changeStripePlan).toHaveBeenCalledWith(
    "price_team_10",
    5,
    "org-1",
  );
  await waitFor(() =>
    expect(ui.getByText(PLAN_CHANGE_LABELS.changed.upgraded)).toBeTruthy(),
  );
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("two confirmations before a re-render start one change", async () => {
  const pending = Promise.withResolvers<string>();
  const { organizations } = stubSdk(() => pending.promise);
  const { button, ui } = renderSwitcher();
  await waitFor(() => expect(ui.getByText("Team 10")).toBeTruthy());

  act(() => button("Team 10").click());
  const confirm = ui.getByText(PLAN_CHANGE_LABELS.confirmUpgrade);
  act(() => {
    confirm.click();
    confirm.click();
  });

  expect(organizations.changeStripePlan).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve("upgraded"));
});

test("switching organization drops a pending choice and a change in flight", async () => {
  const pending = Promise.withResolvers<string>();
  const { organizations } = stubSdk(() => pending.promise);
  const { billing, view } = billingFixture(true, true, false);
  const refresh = mock(() => Promise.resolve());
  const switcher = (organizationId: string) => (
    <BillingStripePlanSwitcher
      billing={{ billing, refresh, view }}
      disabled={false}
      organizationId={organizationId}
    />
  );
  const ui = render(switcher("org-1"));
  const button = (row: string) =>
    ui
      .getByText(row)
      .closest(".mini-app-row")
      ?.querySelector("button") as HTMLButtonElement;
  await waitFor(() => expect(ui.getByText("Team 10")).toBeTruthy());

  // A confirmation shown for one organization is gone for the next.
  act(() => button("Solo").click());
  ui.rerender(switcher("org-2"));
  await waitFor(() => expect(ui.getByText("Team 10")).toBeTruthy());
  expect(ui.queryByText(PLAN_CHANGE_LABELS.confirmDowngrade)).toBeNull();

  // A change in flight for org-2 neither keeps org-3 busy nor reports to it.
  act(() => button("Team 10").click());
  act(() => ui.getByText(PLAN_CHANGE_LABELS.confirmUpgrade).click());
  expect(organizations.changeStripePlan).toHaveBeenCalledTimes(1);
  ui.rerender(switcher("org-3"));
  await waitFor(() => expect(button("Team 10").disabled).toBe(false));
  await act(async () => pending.resolve("upgraded"));
  expect(ui.queryByText(PLAN_CHANGE_LABELS.changed.upgraded)).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});

test("a declined upgrade says nothing changed and is not reported", async () => {
  const { logError } = stubSdk(() =>
    Promise.reject(
      Object.assign(new Error("declined"), {
        code: BILLING_ERROR_CODES.planChangePaymentFailed,
      }),
    ),
  );
  const { button, refresh, ui } = renderSwitcher();
  await waitFor(() => expect(ui.getByText("Team 10")).toBeTruthy());

  act(() => button("Team 10").click());
  await act(async () =>
    ui.getByText(PLAN_CHANGE_LABELS.confirmUpgrade).click(),
  );

  await waitFor(() =>
    expect(ui.getByText(PLAN_CHANGE_LABELS.paymentFailed)).toBeTruthy(),
  );
  expect(refresh).not.toHaveBeenCalled();
  expect(logError).not.toHaveBeenCalled();
});

test("a plan the server refuses shows its reason and reloads the plans", async () => {
  const reason =
    "The plan does not cover the organization's members; remove members first";
  const { logError, organizations } = stubSdk(() =>
    Promise.reject(
      Object.assign(new Error(reason), {
        code: BILLING_ERROR_CODES.planChangeUnavailable,
      }),
    ),
  );
  const { button, ui } = renderSwitcher();
  await waitFor(() => expect(ui.getByText("Solo")).toBeTruthy());

  act(() => button("Solo").click());
  await act(async () =>
    ui.getByText(PLAN_CHANGE_LABELS.confirmDowngrade).click(),
  );

  await waitFor(() =>
    expect(organizations.loadStripeCheckoutOptions).toHaveBeenCalledTimes(2),
  );
  await waitFor(() => expect(ui.getByText(reason)).toBeTruthy());
  expect(logError).not.toHaveBeenCalled();
});

test("a roster changed elsewhere reads the plans again", async () => {
  const { organizations } = stubSdk(() => Promise.resolve("scheduled"));
  const { billing, view } = billingFixture(true, true, false);
  const refresh = mock(() => Promise.resolve());
  const switcher = (activeMemberCount: number) => (
    <BillingStripePlanSwitcher
      billing={{ billing: { ...billing, activeMemberCount }, refresh, view }}
      disabled={false}
      organizationId="org-1"
    />
  );
  const ui = render(switcher(3));
  await waitFor(() => expect(ui.getByText("Team 10")).toBeTruthy());

  // Members were removed in another view: smaller plans may now cover it.
  ui.rerender(switcher(1));

  await waitFor(() =>
    expect(organizations.loadStripeCheckoutOptions).toHaveBeenCalledTimes(2),
  );
});

test("a downgrade is confirmed for renewal, and cancelling it changes nothing", async () => {
  const { organizations } = stubSdk(() => Promise.resolve("scheduled"));
  const { button, ui } = renderSwitcher();
  await waitFor(() => expect(ui.getByText("Solo")).toBeTruthy());

  act(() => button("Solo").click());
  expect(
    ui.getByText(PLAN_CHANGE_LABELS.confirmDowngrade).closest("button"),
  ).toBeTruthy();
  act(() => ui.getByText(PLAN_CHANGE_LABELS.cancel).click());

  expect(ui.queryByText(PLAN_CHANGE_LABELS.confirmDowngrade)).toBeNull();
  expect(organizations.changeStripePlan).not.toHaveBeenCalled();
});

test("a scheduled downgrade can be kept from, but not chosen again", async () => {
  const { organizations } = stubSdk(() => Promise.resolve("kept"));
  const { button, ui } = renderSwitcher(1);
  await waitFor(() => expect(ui.getByText("Solo")).toBeTruthy());

  expect(button("Solo")).toMatchObject({
    disabled: true,
    textContent: ORG_MANAGER_LABELS.billingPlanScheduled,
  });
  act(() => button("Team 5").click());
  await act(async () => ui.getByText(PLAN_CHANGE_LABELS.confirmKeep).click());

  expect(organizations.changeStripePlan).toHaveBeenCalledWith(
    "price_team_5",
    5,
    "org-1",
  );
});

test("a subscription not bought through Stripe offers no plan change", () => {
  const { organizations } = stubSdk(() => Promise.resolve("upgraded"));
  const { billing, view } = billingFixture(true, true, false);
  const ui = render(
    <BillingStripePlanSwitcher
      billing={{
        billing,
        refresh: () => Promise.resolve(),
        view: { ...view, subscriptionSource: "native" },
      }}
      disabled={false}
      organizationId="org-1"
    />,
  );

  expect(ui.container.textContent).toBe("");
  expect(organizations.loadStripeCheckoutOptions).not.toHaveBeenCalled();
});
