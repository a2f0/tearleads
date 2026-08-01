import { afterEach, expect, test } from "bun:test";
import type {
  OrganizationBillingView,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import {
  getOrgManagerPeriodEndsLabel,
  getOrgManagerTrialEndsLabel,
  ORG_MANAGER_LABELS,
} from "../labels";
import { allowsNativePurchase } from "./BillingPanel";
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
    minimumSeatCount: 1,
    options: [],
    managementUrl: null,
    busy: null,
    activationPending: false,
    actionError: null,
    onManageSubscription: () => undefined,
    onStartTrial: () => undefined,
    onSubscribe: () => undefined,
    onRestore: () => undefined,
    onRefresh: () => undefined,
    ...overrides,
  };
}

const OPTION: SyncSubscriptionOption = {
  tierId: "solo",
  seatLimit: 1,
  packageId: "monthly",
  productId: "sync_monthly",
  title: "Sync",
  description: "Cloud sync",
  priceLabel: "$4.99",
};

const TEAM_OPTION: SyncSubscriptionOption = {
  ...OPTION,
  tierId: "team_5",
  seatLimit: 5,
  packageId: "team_5",
  productId: "sync_team_5_monthly",
  title: "Team (up to 5)",
  priceLabel: "$9.99",
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

test("an active subscription shows licensed capacity and the period end date", () => {
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
  expect(view.getByText("3 licensed seats")).toBeDefined();
  expect(
    view.getByText(getOrgManagerPeriodEndsLabel(formatMiniAppDate(endsAtMs))),
  ).toBeDefined();
});

test("a trialing organization shows the trial end date, not licensed seats", () => {
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
  // A free trial is not billed, so no licensed-capacity label appears.
  expect(view.queryByText(/licensed seat/)).toBeNull();
});

test("a local organization shows no seats or period date", () => {
  const view = render(<BillingView {...props({})} />);
  expect(view.queryByText(/licensed seat/)).toBeNull();
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
  fireEvent.click(
    view.getByRole("button", { name: ORG_MANAGER_LABELS.billingSubscribe }),
  );
  expect(chosen).toEqual(["monthly"]);
});

test("native purchase options exclude tiers below the active roster", () => {
  const view = render(
    <BillingView
      {...props({
        view: billingView({ status: "trialing", isLocal: false }),
        purchaseAvailable: true,
        canSubscribe: true,
        minimumSeatCount: 2,
        options: [OPTION, TEAM_OPTION],
      })}
    />,
  );

  expect(view.queryByText(OPTION.title)).toBeNull();
  expect(view.getByText(TEAM_OPTION.title)).toBeDefined();
});

test("native options wait for the authoritative roster count", () => {
  const view = render(
    <BillingView
      {...props({
        view: billingView({ status: "trialing", isLocal: false }),
        purchaseAvailable: true,
        canSubscribe: true,
        minimumSeatCount: null,
        options: [OPTION],
      })}
    />,
  );

  expect(view.getByText(ORG_MANAGER_LABELS.loadingBilling)).toBeDefined();
  expect(view.queryByText(ORG_MANAGER_LABELS.billingNoOptions)).toBeNull();
});

test("subscription actions use the standard button styling", () => {
  const view = render(
    <BillingView
      {...props({
        view: billingView({ status: "disabled", isLocal: false }),
        purchaseAvailable: true,
        canSubscribe: true,
        options: [OPTION],
        managementUrl: "https://billing.example/manage",
      })}
    />,
  );

  for (const button of view.getAllByRole("button")) {
    expect(button.classList.contains("mini-app-button")).toBe(true);
    expect(button.classList.contains("mini-app-row--button")).toBe(false);
  }
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

test("native checkout directs custom organizations to the web", () => {
  const view = render(
    <BillingView
      {...props({
        view: billingView({ status: "disabled", isLocal: false }),
        nativePurchaseRestricted: true,
        purchaseAvailable: false,
      })}
    />,
  );
  expect(
    view.getByText(ORG_MANAGER_LABELS.billingCustomOrganizationWebOnly),
  ).toBeDefined();
  expect(
    view.queryByText(ORG_MANAGER_LABELS.billingPurchaseUnavailable),
  ).toBeNull();
});

test("the direct-checkout path shows no subscribe list and no unavailable hint", () => {
  // `purchaseAvailable` is off (the container hides the RC list where the card
  // checkout is the path), but a purchase path DOES exist — the checkout mounts
  // below this view — so the "unavailable" hint must stay hidden.
  const view = render(
    <BillingView
      {...props({
        view: billingView({ status: "disabled", isLocal: false }),
        purchaseAvailable: false,
        directCheckoutAvailable: true,
      })}
    />,
  );
  expect(
    view.queryByText(ORG_MANAGER_LABELS.billingPurchaseUnavailable),
  ).toBeNull();
  expect(view.queryByText(ORG_MANAGER_LABELS.billingSubscribe)).toBeNull();
});

test("subscription management delegates to the platform override", () => {
  const managed: string[] = [];
  const view = render(
    <BillingView
      {...props({
        view: billingView({
          status: "active",
          isLocal: false,
          isActive: true,
        }),
        managementUrl: "https://apps.apple.com/account/subscriptions",
        onManageSubscription: (url) => managed.push(url),
      })}
    />,
  );

  fireEvent.click(
    view.getByRole("button", {
      name: ORG_MANAGER_LABELS.billingManageSubscription,
    }),
  );

  expect(managed).toEqual(["https://apps.apple.com/account/subscriptions"]);
});

test("no manage button renders without a management URL", () => {
  const view = render(
    <BillingView
      {...props({
        view: billingView({ status: "active", isLocal: false, isActive: true }),
        managementUrl: null,
      })}
    />,
  );
  expect(
    view.queryByRole("button", {
      name: ORG_MANAGER_LABELS.billingManageSubscription,
    }),
  ).toBeNull();
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

test("shows the Cancel button only during an embedded subscribe", () => {
  const embeddedBusy = props({
    purchaseAvailable: true,
    embeddedCheckout: true,
    busy: "subscribe:monthly",
    checkoutActive: true,
  });
  const view = render(<BillingView {...embeddedBusy} />);
  expect(
    view.getByText(ORG_MANAGER_LABELS.billingCancelCheckout),
  ).toBeDefined();

  // Idle: no purchase to cancel.
  view.rerender(
    <BillingView
      {...props({ purchaseAvailable: true, embeddedCheckout: true })}
    />,
  );
  expect(view.queryByText(ORG_MANAGER_LABELS.billingCancelCheckout)).toBeNull();

  // Native platforms present their own store sheet with its own dismissal —
  // an in-app Cancel button there would mislead.
  view.rerender(
    <BillingView
      {...props({
        purchaseAvailable: true,
        busy: "subscribe:monthly",
        checkoutActive: true,
      })}
    />,
  );
  expect(view.queryByText(ORG_MANAGER_LABELS.billingCancelCheckout)).toBeNull();

  // A settled purchase awaiting the billing refresh: still busy, but there is
  // no checkout left to cancel.
  view.rerender(
    <BillingView
      {...props({
        purchaseAvailable: true,
        embeddedCheckout: true,
        busy: "subscribe:monthly",
        checkoutActive: false,
      })}
    />,
  );
  expect(view.queryByText(ORG_MANAGER_LABELS.billingCancelCheckout)).toBeNull();
});

test("clicking the Cancel button dismisses the embedded checkout", () => {
  let cancelled = 0;
  const view = render(
    <BillingView
      {...props({
        purchaseAvailable: true,
        embeddedCheckout: true,
        busy: "subscribe:monthly",
        checkoutActive: true,
        onCancelCheckout: () => {
          cancelled += 1;
        },
      })}
    />,
  );
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.billingCancelCheckout));
  expect(cancelled).toBe(1);
});

test("unmounting the checkout host dismisses the purchase", () => {
  // Any path that removes the host must cancel the purchase riding in it —
  // here the buyer's admin role is revoked mid-purchase.
  let cancelled = 0;
  const shared = {
    purchaseAvailable: true,
    embeddedCheckout: true,
    busy: "subscribe:monthly",
    onCancelCheckout: () => {
      cancelled += 1;
    },
  };
  const view = render(<BillingView {...props(shared)} />);
  expect(cancelled).toBe(0);

  view.rerender(<BillingView {...props({ ...shared, isOrgAdmin: false })} />);
  expect(cancelled).toBe(1);
});

test("native purchases get no checkout host and no detach cancellation", () => {
  // On Capacitor the purchase runs in a store sheet the app cannot cancel:
  // there must be no embedded host whose unmount would settle the flow as
  // cancelled while the sheet is still up.
  let cancelled = 0;
  const shared = {
    purchaseAvailable: true,
    embeddedCheckout: false,
    busy: "subscribe:monthly",
    onCancelCheckout: () => {
      cancelled += 1;
    },
  };
  const view = render(<BillingView {...props(shared)} />);
  expect(
    view.container.querySelector(".org-manager-billing-checkout"),
  ).toBeNull();

  view.rerender(<BillingView {...props({ ...shared, isOrgAdmin: false })} />);
  expect(cancelled).toBe(0);
});

test("past-due Stripe billing cannot be replaced by a native purchase", () => {
  const shared = { isPersonalOrganization: true } as const;
  expect(
    allowsNativePurchase({
      ...shared,
      isActive: false,
      status: "past_due",
      subscriptionSource: "stripe",
    }),
  ).toBe(false);
});
