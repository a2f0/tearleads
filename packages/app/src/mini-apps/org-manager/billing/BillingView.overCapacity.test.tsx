import { afterEach, expect, test } from "bun:test";
import type { SyncSubscriptionOption } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
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
];

const PROPS: BillingViewProps = {
  view: {
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
    needsAttention: false,
  },
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
  onManageSubscription: () => undefined,
  onStartTrial: () => undefined,
  onSubscribe: () => undefined,
  onRestore: () => undefined,
  onRefresh: () => undefined,
};

test("native options explain when the roster exceeds every tier", () => {
  const view = render(<BillingView {...PROPS} />);

  expect(
    view.getByText(ORG_MANAGER_LABELS.billingCheckoutOverCapacity),
  ).toBeDefined();
  expect(view.queryByText(ORG_MANAGER_LABELS.billingNoOptions)).toBeNull();
});
