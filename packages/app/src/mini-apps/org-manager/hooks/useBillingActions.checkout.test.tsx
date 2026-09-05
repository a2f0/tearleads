import { afterEach, expect, mock, test } from "bun:test";
import {
  PurchaseAbortedError,
  PurchaseCancelledError,
  type PurchasesCapability,
  type SyncPurchaseResult,
} from "@tearleads/client-sdk";
import { act, cleanup, waitFor } from "@testing-library/react";
import {
  createPurchases,
  OPTION,
  purchaseTraceEntries,
  renderBillingActions,
} from "../../../../test/helpers/billingActionsTestKit";
import { ORG_MANAGER_LABELS } from "../labels";

afterEach(() => cleanup());

test("purchase failures emit an ordered error trace", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: false }),
    purchaseSync: mock(() =>
      Promise.reject({
        code: "5",
        underlyingErrorMessage: "Product is unavailable",
        userCancelled: null,
      }),
    ) as PurchasesCapability["purchaseSync"],
  };
  const { result } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));

  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(purchaseTraceEntries(result.current.logEntries)).toEqual([
    { level: "info", message: "billing purchase stage=started" },
    { level: "info", message: "billing purchase stage=eligibility-checked" },
    { level: "info", message: "billing purchase stage=identified" },
    { level: "info", message: "billing purchase stage=provider-started" },
    {
      level: "error",
      message:
        "billing purchase stage=failed code=product-unavailable native=none userCancelled=unknown",
    },
  ]);
});

test("server preflight blocks the provider before a native purchase", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  const { result } = renderBillingActions({
    checkNativePurchaseEligibility: () =>
      Promise.resolve({
        eligible: false,
        reason: "stripe_subscription_conflict",
      }),
    purchases,
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));

  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.actionError).toBe(
    ORG_MANAGER_LABELS.billingEligibilityStripeConflict,
  );
  expect(purchases.purchaseSync).not.toHaveBeenCalled();
  expect(purchaseTraceEntries(result.current.logEntries)).toEqual([
    { level: "info", message: "billing purchase stage=started" },
    {
      level: "error",
      message:
        "billing purchase stage=failed code=other native=none userCancelled=unknown",
    },
  ]);
});

test("a scope switch leaves a native purchase running", async () => {
  const purchaseResolvers: Array<(value: SyncPurchaseResult) => void> = [];
  const purchaseSync = mock((input: { onProviderPresented?: () => void }) => {
    input.onProviderPresented?.();
    return new Promise<SyncPurchaseResult>((resolve) => {
      purchaseResolvers.push(resolve);
    });
  });
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync,
  };
  const { result, rerender } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(1));

  rerender({
    billingIsActive: false,
    organizationId: "org-1",
    userId: "user-2",
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(2));

  // The first (uncancelled) native purchase settling must not disturb the
  // second flow: each attempt owns its own settlement.
  await act(async () => {
    purchaseResolvers[0]?.({ syncEntitlementActive: false });
  });
  expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`);

  await act(async () => {
    purchaseResolvers[1]?.({ syncEntitlementActive: true });
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.activationPending).toBe(true);
});

test("a scope switch cancels native identification before provider start", async () => {
  let identifyCalls = 0;
  let resolvePurchaseIdentify: (() => void) | undefined;
  const identify = mock(() => {
    identifyCalls += 1;
    if (identifyCalls === 2) {
      return new Promise<void>((resolve) => {
        resolvePurchaseIdentify = resolve;
      });
    }
    return Promise.resolve();
  });
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    identify,
  };
  const { result, rerender } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(identify).toHaveBeenCalledTimes(2));
  rerender({
    billingIsActive: false,
    organizationId: "org-1",
    userId: "user-2",
  });

  await act(async () => resolvePurchaseIdentify?.());
  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(purchases.purchaseSync).not.toHaveBeenCalled();
  expect(purchaseTraceEntries(result.current.logEntries).slice(-2)).toEqual([
    { level: "info", message: "billing purchase stage=eligibility-checked" },
    { level: "info", message: "billing purchase stage=cancelled" },
  ]);
});

test("unmounting the panel aborts a purchase before the sheet presents", async () => {
  const purchaseSignals: Array<AbortSignal | undefined> = [];
  const purchaseSync = mock(
    (input: { abortSignal?: AbortSignal }) =>
      new Promise<SyncPurchaseResult>(() => {
        purchaseSignals.push(input.abortSignal);
      }),
  );
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync: purchaseSync as PurchasesCapability["purchaseSync"],
  };
  const { result, unmount } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() => expect(purchaseSignals).toHaveLength(1));
  expect(purchaseSignals[0]?.aborted).toBe(false);

  // Leaving the panel must abort the signal so a purchase still in native
  // preparation never opens a store sheet nothing is waiting for.
  unmount();

  expect(purchaseSignals[0]?.aborted).toBe(true);
});

test("losing eligibility settles the flow even while identification hangs", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    identify: mock(() => new Promise<void>(() => undefined)),
  };
  const { result, rerender } = renderBillingActions({ purchases });
  // Options never load (identify hangs), but subscribe is driven directly.
  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() =>
    expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`),
  );

  rerender({
    billingIsActive: false,
    isOrgAdmin: false,
    organizationId: "org-1",
    userId: "user-1",
  });

  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.actionError).toBe(null);
  expect(purchases.purchaseSync).not.toHaveBeenCalled();
});

test("a cancelled flow's late rejection is traced, never surfaced", async () => {
  let rejectPurchase: ((error: Error) => void) | undefined;
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync: mock(
      () =>
        new Promise<SyncPurchaseResult>((_, reject) => {
          rejectPurchase = reject;
        }),
    ),
  };
  const { result, rerender } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() => expect(rejectPurchase).toBeDefined());
  rerender({
    billingIsActive: false,
    isOrgAdmin: false,
    organizationId: "org-1",
    userId: "user-1",
  });
  await waitFor(() => expect(result.current.busy).toBe(null));

  // The abandoned attempt settles on its own as the pre-sheet abort.
  await act(async () => {
    rejectPurchase?.(new PurchaseAbortedError());
  });

  expect(result.current.actionError).toBe(null);
  expect(purchaseTraceEntries(result.current.logEntries).at(-1)).toEqual({
    level: "error",
    message:
      "billing purchase stage=late-failed code=other native=none userCancelled=unknown",
  });
});

test("a cancelled checkout clears the busy state without an error", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync: mock(() => Promise.reject(new PurchaseCancelledError())),
  };
  const { result } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });

  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.actionError).toBe(null);
  expect(result.current.activationPending).toBe(false);
  expect(purchaseTraceEntries(result.current.logEntries)).toEqual([
    { level: "info", message: "billing purchase stage=started" },
    { level: "info", message: "billing purchase stage=eligibility-checked" },
    { level: "info", message: "billing purchase stage=identified" },
    { level: "info", message: "billing purchase stage=provider-started" },
    { level: "info", message: "billing purchase stage=cancelled" },
  ]);
});

test("an abandoned purchase is distinct from a cancelled checkout", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync: mock(() => Promise.reject(new PurchaseAbortedError())),
  };
  const { result } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));

  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(purchaseTraceEntries(result.current.logEntries).at(-1)).toEqual({
    level: "info",
    message: "billing purchase stage=aborted",
  });
});

/**
 * `markActivationPending` is the hand-off the in-app card checkout (issue
 * #1654) calls once Stripe confirms a payment: the entitlement still has to
 * travel Stripe -> RevenueCat -> our webhook, so the panel must show
 * activation-pending and start the shared backoff poll rather than refresh
 * once and appear stuck.
 */
test("an exhausted activation poll releases plan actions", async () => {
  const refresh = mock(() => Promise.resolve());
  const { result } = renderBillingActions({
    purchases: createPurchases({ syncEntitlementActive: false }),
    // A single delay so the poll runs one extra pass and then gives up.
    activationPollDelaysMs: [0],
    refresh,
  });
  const refreshesBefore = refresh.mock.calls.length;

  await act(async () => {
    result.current.markActivationPending();
  });

  await waitFor(() =>
    expect(refresh.mock.calls.length).toBeGreaterThan(refreshesBefore),
  );
  await waitFor(() => expect(result.current.activationPending).toBe(false));
  expect(result.current.actionError).toBe(
    ORG_MANAGER_LABELS.billingActivationUnconfirmed,
  );
});

test("marking activation pending clears a previous action error", async () => {
  // A retry after a failed attempt must not leave the old error under the
  // activation-pending status.
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: false }),
    purchaseSync: mock(() =>
      Promise.reject(new Error("card declined")),
    ) as PurchasesCapability["purchaseSync"],
  };
  const { result } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    await result.current.subscribe(OPTION);
  });
  await waitFor(() => expect(result.current.actionError).not.toBeNull());

  await act(async () => {
    result.current.markActivationPending();
  });

  expect(result.current.actionError).toBeNull();
  expect(result.current.activationPending).toBe(true);
});
