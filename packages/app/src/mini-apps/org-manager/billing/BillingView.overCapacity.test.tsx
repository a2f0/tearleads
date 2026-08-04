import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationBillingView,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
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
  pendingSeatCount: null,
  needsAttention: false,
};

const PROPS: BillingViewProps = {
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
): BillingViewProps {
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
