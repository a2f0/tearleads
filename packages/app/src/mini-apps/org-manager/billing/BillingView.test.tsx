import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationBillingView,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import {
  getOrgManagerPeriodEndsLabel,
  getOrgManagerSeatsLabel,
  getOrgManagerTrialEndsLabel,
  ORG_MANAGER_LABELS,
} from "../labels";
import { BillingView, type BillingViewProps } from "./BillingView";

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
    currentPeriodStartsAtMs: null,
    currentPeriodEndsAtMs: null,
    seatCount: 0,
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

test("an active subscription shows seats billed and the period end date", () => {
  const endsAtMs = Date.parse("2026-08-15T12:00:00Z");
  const view = render(
    <BillingView
      {...props({
        view: billingView({
          status: "active",
          canSync: true,
          isLocal: false,
          isActive: true,
          seatCount: 3,
          currentPeriodEndsAtMs: endsAtMs,
        }),
      })}
    />,
  );
  expect(view.getByText(getOrgManagerSeatsLabel(3))).toBeDefined();
  expect(
    view.getByText(getOrgManagerPeriodEndsLabel(formatMiniAppDate(endsAtMs))),
  ).toBeDefined();
});

test("a trialing organization shows the trial end date, not billed seats", () => {
  const trialEndsAtMs = Date.parse("2026-07-25T12:00:00Z");
  const view = render(
    <BillingView
      {...props({
        view: billingView({
          status: "trialing",
          canSync: true,
          isLocal: false,
          isTrialing: true,
          trialDaysRemaining: 5,
          trialEndsAtMs,
          seatCount: 2,
        }),
      })}
    />,
  );
  expect(
    view.getByText(
      getOrgManagerTrialEndsLabel(formatMiniAppDate(trialEndsAtMs)),
    ),
  ).toBeDefined();
  // A free trial is not billed, so no "seats billed" label appears.
  expect(view.queryByText(/billed/)).toBeNull();
});

test("a local organization shows no seats or period date", () => {
  const view = render(<BillingView {...props({})} />);
  expect(view.queryByText(/billed/)).toBeNull();
  expect(view.queryByText(/Current period ends/)).toBeNull();
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

test("platforms without purchases show the unavailable-purchases hint", () => {
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
