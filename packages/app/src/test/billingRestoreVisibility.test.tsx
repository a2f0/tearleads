import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  BillingView,
  type BillingViewProps,
} from "../mini-apps/org-manager/billing/BillingView";
import { ORG_MANAGER_LABELS } from "../mini-apps/org-manager/labels";

afterEach(() => cleanup());

function props(overrides: Partial<BillingViewProps> = {}): BillingViewProps {
  return {
    actionError: null,
    activationPending: false,
    busy: null,
    canSubscribe: false,
    error: null,
    isOrgAdmin: true,
    loading: false,
    managementUrl: null,
    minimumSeatCount: 1,
    onManageSubscription: () => undefined,
    onRefresh: () => undefined,
    onRestore: () => undefined,
    onStartTrial: () => undefined,
    onSubscribe: () => undefined,
    options: [],
    purchaseAvailable: false,
    restoreAvailable: true,
    view: {
      canSync: true,
      currentPeriodEndsAtMs: null,
      currentPeriodStartsAtMs: null,
      isActive: true,
      isLocal: false,
      isTrialing: false,
      needsAttention: false,
      seatCount: 1,
      status: "active",
      trialDaysRemaining: null,
      trialEndsAtMs: null,
    },
    ...overrides,
  };
}

test("restore remains available when an active subscription hides buying", () => {
  const view = render(
    <BillingView {...props({ purchaseSectionHidden: true })} />,
  );

  expect(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.billingRestore }),
  ).toBeDefined();
  expect(view.queryByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeNull();
});

test("a custom organization keeps restore beside its web-only guidance", () => {
  const view = render(
    <BillingView {...props({ nativePurchaseRestricted: true })} />,
  );

  expect(
    view.getByText(ORG_MANAGER_LABELS.billingCustomOrganizationWebOnly),
  ).toBeDefined();
  expect(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.billingRestore }),
  ).toBeDefined();
});
