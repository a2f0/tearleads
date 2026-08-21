import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationBillingView,
  SyncSubscriptionOption,
} from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import {
  getOrgManagerPeriodEndsLabel,
  getOrgManagerTrialEndsLabel,
  ORG_MANAGER_LABELS,
} from "../labels";
import { BillingView, type BillingViewProps } from "./BillingView";

afterEach(() => cleanup());

const OPTIONS: SyncSubscriptionOption[] = [
  {
    tierId: "solo",
    seatLimit: 1,
    packageId: "solo",
    productId: "sync_solo_monthly",
    title: "Solo",
    description: "Cloud sync",
    priceLabel: "$4.99",
  },
  {
    tierId: "team_5",
    seatLimit: 5,
    packageId: "team_5",
    productId: "sync_team_5_monthly",
    title: "Team (up to 5)",
    description: "Cloud sync",
    priceLabel: "$9.99",
  },
  {
    tierId: "team_10",
    seatLimit: 10,
    packageId: "team_10",
    productId: "sync_team_10_monthly",
    title: "Team (up to 10)",
    description: "Cloud sync",
    priceLabel: "$19.99",
  },
];

const BASE_VIEW: OrganizationBillingView = {
  status: "trialing",
  canSync: true,
  isLocal: false,
  isTrialing: true,
  isActive: false,
  trialDaysRemaining: 3,
  trialEndsAtMs: Date.UTC(2026, 7, 3),
  currentPeriodStartsAtMs: null,
  currentPeriodEndsAtMs: null,
  seatCount: 10,
  assignedSeatCount: 10,
  currentUserHasSyncSeat: true,
  syncSeatUnavailable: false,
  pendingSeatCount: null,
  needsAttention: false,
};

const PROPS: BillingViewProps & { readonly view: OrganizationBillingView } = {
  view: BASE_VIEW,
  loading: false,
  error: null,
  isOrgAdmin: true,
  purchaseAvailable: true,
  restoreAvailable: false,
  canSubscribe: true,
  minimumSeatCount: 11,
  options: OPTIONS,
  managementUrl: null,
  busy: null,
  activationPending: false,
  actionError: null,
  actionErrorIsOptionsError: false,
  optionsRetryAvailable: false,
  onManageSubscription: () => undefined,
  onStartTrial: () => undefined,
  onSubscribe: () => undefined,
  onRestore: () => undefined,
  onRetryOptions: () => undefined,
  onRefresh: () => undefined,
};

test("native options explain when the roster exceeds every tier", () => {
  const view = render(<BillingView {...PROPS} />);

  expect(
    view.getByText(ORG_MANAGER_LABELS.billingCheckoutOverCapacity),
  ).toBeDefined();
  expect(view.queryByText(ORG_MANAGER_LABELS.billingNoOptions)).toBeNull();
});

function activePlanProps(
  seatCount: number,
  pendingSeatCount: number | null,
): BillingViewProps & { readonly view: OrganizationBillingView } {
  return {
    ...PROPS,
    minimumSeatCount: 1,
    view: {
      ...BASE_VIEW,
      status: "active",
      isActive: true,
      isTrialing: false,
      trialDaysRemaining: null,
      trialEndsAtMs: null,
      seatCount,
      pendingSeatCount,
    },
  };
}

test("an active native subscription renders a plan switcher", () => {
  const chosen: string[] = [];
  const view = render(
    <BillingView
      {...activePlanProps(1, null)}
      onSubscribe={(option) => chosen.push(option.packageId)}
    />,
  );

  expect(
    (
      view.getByRole("button", {
        name: ORG_MANAGER_LABELS.billingCurrentPlan,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(view.queryByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeNull();
  const [firstUpgrade] = view.getAllByRole("button", {
    name: ORG_MANAGER_LABELS.billingUpgradePlan,
  });
  if (!firstUpgrade) throw new Error("Expected an upgrade option");
  fireEvent.click(firstUpgrade);
  expect(chosen).toEqual(["team_5"]);
});

test("a non-tier capacity does not masquerade as a current plan", () => {
  const view = render(<BillingView {...activePlanProps(3, null)} />);

  expect(
    view.queryByRole("button", {
      name: ORG_MANAGER_LABELS.billingCurrentPlan,
    }),
  ).toBeNull();
  expect(
    view.getAllByRole("button", {
      name: ORG_MANAGER_LABELS.billingUpgradePlan,
    }),
  ).toHaveLength(2);
});

test("a deferred downgrade stays scheduled while the paid tier is current", () => {
  const view = render(<BillingView {...activePlanProps(5, 1)} />);

  expect(
    (
      view.getByRole("button", {
        name: ORG_MANAGER_LABELS.billingPlanScheduled,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      view.getByRole("button", {
        name: ORG_MANAGER_LABELS.billingUpgradePlan,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(
    (
      view.getByRole("button", {
        name: ORG_MANAGER_LABELS.billingCurrentPlan,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test("an immediate upgrade waits for its effective event", () => {
  const view = render(<BillingView {...activePlanProps(1, 5)} />);

  expect(
    (
      view.getByRole("button", {
        name: ORG_MANAGER_LABELS.billingPlanUpdating,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test("a scheduled tier below the roster stays visible as a conflict", () => {
  const view = render(
    <BillingView {...activePlanProps(5, 1)} minimumSeatCount={5} />,
  );

  expect(
    view.getByText(ORG_MANAGER_LABELS.billingPlanScheduledCapacityConflict),
  ).toBeDefined();
  expect(
    (
      view.getByRole("button", {
        name: ORG_MANAGER_LABELS.billingCurrentPlan,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      view.getByRole("button", {
        name: ORG_MANAGER_LABELS.billingUpgradePlan,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

test("an active subscription shows current seat usage and its period end", () => {
  const endsAtMs = Date.parse("2026-08-15T12:00:00Z");
  const base = activePlanProps(3, null);
  const view = render(
    <BillingView
      {...base}
      view={{
        ...base.view,
        assignedSeatCount: 2,
        currentPeriodEndsAtMs: endsAtMs,
      }}
    />,
  );

  expect(view.getByText("2 of 3 seats in use")).toBeDefined();
  expect(view.getByText("3 licensed seats")).toBeDefined();
  expect(
    view.getByText(getOrgManagerPeriodEndsLabel(formatMiniAppDate(endsAtMs))),
  ).toBeDefined();
});

test("a trial shows top-tier capacity and current seat usage", () => {
  const trialEndsAtMs = Date.parse("2026-08-09T12:00:00Z");
  const view = render(
    <BillingView
      {...PROPS}
      view={{
        ...PROPS.view,
        assignedSeatCount: 4,
        trialEndsAtMs,
      }}
    />,
  );

  expect(view.getByText("4 of 10 seats in use")).toBeDefined();
  expect(view.getByText("10 licensed seats")).toBeDefined();
  expect(
    view.getByText(
      getOrgManagerTrialEndsLabel(formatMiniAppDate(trialEndsAtMs)),
    ),
  ).toBeDefined();
});

test("an active user without a seat sees the seat-specific sync state", () => {
  const base = activePlanProps(5, null);
  const view = render(
    <BillingView
      {...base}
      view={{
        ...base.view,
        assignedSeatCount: 5,
        canSync: false,
        currentUserHasSyncSeat: false,
        needsAttention: true,
        syncSeatUnavailable: true,
      }}
    />,
  );

  expect(
    view.getByText(ORG_MANAGER_LABELS.billingSyncSeatUnavailable),
  ).toBeDefined();
});

test("a local organization shows no seats or period date", () => {
  const view = render(
    <BillingView
      {...PROPS}
      view={{
        ...BASE_VIEW,
        assignedSeatCount: 0,
        canSync: false,
        currentUserHasSyncSeat: false,
        isLocal: true,
        isTrialing: false,
        needsAttention: false,
        seatCount: 0,
        status: "local",
        trialDaysRemaining: null,
        trialEndsAtMs: null,
      }}
    />,
  );

  expect(view.queryByText(/licensed seat/)).toBeNull();
  expect(view.queryByText(/Current period ends/)).toBeNull();
});
