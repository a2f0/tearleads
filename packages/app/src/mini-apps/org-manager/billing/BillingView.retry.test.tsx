import { afterEach, expect, test } from "bun:test";
import type { OrganizationBillingView } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingView, type BillingViewProps } from "./BillingView";

afterEach(() => cleanup());

const VIEW: OrganizationBillingView = {
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
  pendingSeatCount: null,
  needsAttention: false,
};

function props(onRetryOptions: () => void): BillingViewProps {
  return {
    view: VIEW,
    loading: false,
    error: null,
    isOrgAdmin: true,
    purchaseAvailable: true,
    restoreAvailable: false,
    canSubscribe: false,
    minimumSeatCount: 1,
    options: [],
    managementUrl: null,
    busy: null,
    activationPending: false,
    actionError: ORG_MANAGER_LABELS.billingIdentityPending,
    actionErrorIsOptionsError: true,
    optionsRetryAvailable: true,
    onManageSubscription: () => undefined,
    onStartTrial: () => undefined,
    onSubscribe: () => undefined,
    onRestore: () => undefined,
    onRetryOptions,
    onRefresh: () => undefined,
  };
}

test("billing option failures expose a retry action", () => {
  let retries = 0;
  const view = render(
    <BillingView
      {...props(() => {
        retries += 1;
      })}
    />,
  );

  fireEvent.click(
    view.getByRole("button", {
      name: ORG_MANAGER_LABELS.billingRetryOptions,
    }),
  );
  expect(retries).toBe(1);
});

test("billing options without a retryable failure hide the retry action", () => {
  const view = render(
    <BillingView {...props(() => undefined)} optionsRetryAvailable={false} />,
  );

  expect(
    view.queryByRole("button", {
      name: ORG_MANAGER_LABELS.billingRetryOptions,
    }),
  ).toBeNull();
});

test("hidden native options hide their orphaned retry guidance", () => {
  const view = render(
    <BillingView
      {...props(() => undefined)}
      directCheckoutAvailable
      purchaseAvailable={false}
    />,
  );

  expect(
    view.queryByText(ORG_MANAGER_LABELS.billingIdentityPending),
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: ORG_MANAGER_LABELS.billingRetryOptions,
    }),
  ).toBeNull();
});

test("hidden native options retain unrelated action errors", () => {
  const view = render(
    <BillingView
      {...props(() => undefined)}
      actionError={ORG_MANAGER_LABELS.billingManageSubscriptionFailed}
      actionErrorIsOptionsError={false}
      directCheckoutAvailable
      purchaseAvailable={false}
    />,
  );

  expect(
    view.getByText(ORG_MANAGER_LABELS.billingManageSubscriptionFailed),
  ).toBeDefined();
});
