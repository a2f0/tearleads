import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationBillingView,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BillingView, type BillingViewProps } from "./BillingView";
import { ORG_MANAGER_LABELS } from "./labels";

afterEach(() => cleanup());

function billingView(
  overrides: Partial<OrganizationBillingView>,
): OrganizationBillingView {
  return {
    status: "local",
    canSync: false,
    isLocal: true,
    isTrialing: false,
    isActive: false,
    trialDaysRemaining: null,
    trialEndsAtMs: null,
    currentPeriodEndsAtMs: null,
    needsAttention: false,
    ...overrides,
  };
}

function props(overrides: Partial<BillingViewProps>): BillingViewProps {
  return {
    view: billingView({}),
    loading: false,
    error: null,
    isOrgAdmin: true,
    purchaseAvailable: false,
    canSubscribe: false,
    options: [],
    busy: null,
    activationPending: false,
    actionError: null,
    onStartTrial: () => undefined,
    onSubscribe: () => undefined,
    onRestore: () => undefined,
    onRefresh: () => undefined,
    ...overrides,
  };
}

const OPTION: SyncSubscriptionOption = {
  packageId: "monthly",
  productId: "sync_monthly",
  title: "Sync",
  description: "Cloud sync",
  priceLabel: "$4.99",
};

test("shows a loading hint before billing resolves", () => {
  const view = render(
    <BillingView {...props({ view: null, loading: true })} />,
  );
  expect(view.getByText(ORG_MANAGER_LABELS.loadingBilling)).toBeDefined();
});

test("shows an unavailable hint when billing failed to load", () => {
  const view = render(
    <BillingView {...props({ view: null, loading: false })} />,
  );
  expect(view.getByText(ORG_MANAGER_LABELS.billingUnavailable)).toBeDefined();
});

test("an admin can start the free trial from a local organization", () => {
  let started = 0;
  const view = render(
    <BillingView
      {...props({
        view: billingView({ status: "local" }),
        onStartTrial: () => {
          started += 1;
        },
      })}
    />,
  );
  expect(view.getByText(ORG_MANAGER_LABELS.billingSyncOff)).toBeDefined();
  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.billingStartTrial }),
  );
  expect(started).toBe(1);
});

test("a trialing organization shows the days remaining and can sync", () => {
  const view = render(
    <BillingView
      {...props({
        view: billingView({
          status: "trialing",
          canSync: true,
          isLocal: false,
          isTrialing: true,
          trialDaysRemaining: 3,
        }),
      })}
    />,
  );
  expect(view.getByText(ORG_MANAGER_LABELS.billingSyncOn)).toBeDefined();
  expect(view.getByText("3 days left")).toBeDefined();
  // No trial button once the trial is already running.
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.billingStartTrial }),
  ).toBeNull();
});

test("non-admins see a read-only notice and no actions", () => {
  const view = render(<BillingView {...props({ isOrgAdmin: false })} />);
  expect(view.getByText(ORG_MANAGER_LABELS.billingAdminOnly)).toBeDefined();
  expect(
    view.queryByRole("button", { name: ORG_MANAGER_LABELS.billingStartTrial }),
  ).toBeNull();
});

test("subscribe options invoke onSubscribe with the chosen package", () => {
  const chosen: string[] = [];
  const view = render(
    <BillingView
      {...props({
        view: billingView({ status: "disabled", isLocal: false }),
        purchaseAvailable: true,
        canSubscribe: true,
        options: [OPTION],
        onSubscribe: (option) => chosen.push(option.packageId),
      })}
    />,
  );
  fireEvent.click(view.getByText("$4.99").closest("button") as HTMLElement);
  expect(chosen).toEqual(["monthly"]);
});

test("platforms without purchases show the mobile-app hint", () => {
  const view = render(
    <BillingView
      {...props({
        view: billingView({ status: "disabled", isLocal: false }),
        purchaseAvailable: false,
      })}
    />,
  );
  expect(
    view.getByText(ORG_MANAGER_LABELS.billingPurchaseUnavailable),
  ).toBeDefined();
});

test("refresh is always available to an admin", () => {
  let refreshed = 0;
  const view = render(
    <BillingView
      {...props({
        onRefresh: () => {
          refreshed += 1;
        },
      })}
    />,
  );
  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.refresh }),
  );
  expect(refreshed).toBe(1);
});
