import { afterEach, expect, mock, test } from "bun:test";
import type {
  PurchasesCapability,
  SyncPurchaseResult,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import {
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
} from "@tearleads/client-sdk";
import { act, cleanup, waitFor } from "@testing-library/react";
import {
  createPurchases,
  OPTION,
  renderBillingActions,
} from "../../../../test/helpers/billingActionsTestKit";
import { ORG_MANAGER_LABELS } from "../labels";

afterEach(() => cleanup());

test("identifies the buyer before loading subscription options", async () => {
  const calls: string[] = [];
  const purchases: PurchasesCapability = {
    bindOrganization: mock(() => Promise.resolve()),
    isAvailable: true,
    nativeStore: "test_store",
    moveNativeSubscription: mock(() =>
      Promise.resolve({ organizationId: "restored-org" }),
    ),
    identify: mock(() => {
      calls.push("identify");
      return Promise.resolve();
    }),
    reset: mock(() => Promise.resolve()),
    listSyncOptions: mock(() => {
      calls.push("listSyncOptions");
      return Promise.resolve([OPTION]);
    }),
    purchaseSync: mock(() => Promise.resolve({ syncEntitlementActive: true })),
    hasActiveSyncEntitlement: mock(() => Promise.resolve(false)),
  };

  const { result } = renderBillingActions({ purchases });

  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(calls).toEqual(["identify", "listSyncOptions"]);
  expect(purchases.identify).toHaveBeenCalledWith({ userId: "user-1" });
});

test("loads options while the billing identity is still settling", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  purchases.identify = mock(() =>
    Promise.reject(new PurchaseIdentityPendingError()),
  );
  const { result } = renderBillingActions({ purchases });

  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(purchases.listSyncOptions).toHaveBeenCalled();
});

test("disables subscribe while identity is settling after options load", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  purchases.identify = mock(() =>
    Promise.reject(new PurchaseIdentityPendingError()),
  );
  const { result } = renderBillingActions({
    optionsRetryDelaysMs: [],
    purchases,
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(result.current.actionError).toBe(
    ORG_MANAGER_LABELS.billingIdentityPending,
  );
  expect(result.current.canSubscribe).toBe(false);

  await act(async () => result.current.subscribe(OPTION));

  expect(result.current.actionError).toBe(
    ORG_MANAGER_LABELS.billingIdentityPending,
  );
  expect(purchases.identify).toHaveBeenCalledTimes(1);
  expect(purchases.purchaseSync).not.toHaveBeenCalled();
});

test("an options failure does not cancel an open checkout", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  let finishPurchase = (_value: SyncPurchaseResult) => {};
  purchases.purchaseSync = mock(
    () =>
      new Promise<SyncPurchaseResult>((resolve) => {
        finishPurchase = resolve;
      }),
  );
  const { result } = renderBillingActions({
    optionsRetryDelaysMs: [100],
    purchases,
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(result.current.checkoutActive).toBe(true));
  purchases.identify = mock(() =>
    Promise.reject(new PurchaseProviderStalledError()),
  );
  act(() => result.current.retryOptions());

  expect(result.current.actionError).toBeNull();
  expect(result.current.checkoutActive).toBe(true);
  expect(result.current.busy).toBe("subscribe:monthly");

  finishPurchase({ syncEntitlementActive: true });
  await waitFor(() => expect(result.current.busy).toBeNull());
  await waitFor(() =>
    expect(result.current.actionError).toBe(
      ORG_MANAGER_LABELS.billingProviderStalled,
    ),
  );
  expect(result.current.canSubscribe).toBe(false);
});

test("keeps options empty when buyer identification genuinely fails", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  purchases.identify = mock(() => Promise.reject(new Error("invalid buyer")));
  const { result } = renderBillingActions({ purchases });

  await waitFor(() => expect(purchases.identify).toHaveBeenCalled());
  expect(result.current.options).toEqual([]);
  expect(purchases.listSyncOptions).not.toHaveBeenCalled();
});

test("offers a manual retry when stalled option loading recovers", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  let stalled = true;
  purchases.identify = mock(() =>
    stalled
      ? Promise.reject(new PurchaseProviderStalledError())
      : Promise.resolve(),
  );
  const { result } = renderBillingActions({ purchases });

  await waitFor(() =>
    expect(result.current.actionError).toBe(
      ORG_MANAGER_LABELS.billingProviderStalled,
    ),
  );
  expect(purchases.listSyncOptions).not.toHaveBeenCalled();
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(purchases.identify).toHaveBeenCalledTimes(1);
  expect(result.current.optionsRetryAvailable).toBe(true);

  stalled = false;
  act(() => result.current.retryOptions());
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(result.current.actionError).toBeNull();
});

test("shows retry guidance when option loading waits too long", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  let attempts = 0;
  purchases.listSyncOptions = mock(() => {
    attempts += 1;
    return attempts === 1
      ? Promise.reject(new PurchaseIdentityPendingError())
      : Promise.resolve([OPTION]);
  });
  const { result } = renderBillingActions({
    optionsRetryDelaysMs: [100],
    purchases,
  });

  await waitFor(() =>
    expect(result.current.actionError).toBe(
      ORG_MANAGER_LABELS.billingIdentityPending,
    ),
  );
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(result.current.actionError).toBeNull();
});

test("keeps loaded options when a later provider retry fails", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  let identityAttempts = 0;
  purchases.identify = mock(() => {
    identityAttempts += 1;
    return identityAttempts === 1
      ? Promise.reject(new PurchaseIdentityPendingError())
      : Promise.resolve();
  });
  let optionAttempts = 0;
  purchases.listSyncOptions = mock(() => {
    optionAttempts += 1;
    return optionAttempts === 1
      ? Promise.resolve([OPTION])
      : Promise.reject(new Error("provider unavailable"));
  });
  const { result } = renderBillingActions({
    optionsRetryDelaysMs: [100],
    purchases,
  });

  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  await waitFor(() =>
    expect(purchases.listSyncOptions).toHaveBeenCalledTimes(2),
  );
  expect(result.current.options).toEqual([OPTION]);
  await waitFor(() =>
    expect(result.current.actionError).toBe(
      ORG_MANAGER_LABELS.billingOptionsUnavailable,
    ),
  );
  expect(result.current.canSubscribe).toBe(true);
  expect(result.current.optionsRetryAvailable).toBe(true);

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchases.purchaseSync).toHaveBeenCalledTimes(1));
});

test("manual retry preserves the last options until reload settles", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  purchases.identify = mock(() =>
    Promise.reject(new PurchaseIdentityPendingError()),
  );
  let finishReload = (_options: SyncSubscriptionOption[]) => {};
  let optionAttempts = 0;
  purchases.listSyncOptions = mock(() => {
    optionAttempts += 1;
    if (optionAttempts === 1) return Promise.resolve([OPTION]);
    return new Promise<SyncSubscriptionOption[]>((resolve) => {
      finishReload = resolve;
    });
  });
  const { result } = renderBillingActions({
    optionsRetryDelaysMs: [],
    purchases,
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(result.current.canSubscribe).toBe(false);

  act(() => result.current.retryOptions());
  await waitFor(() =>
    expect(purchases.listSyncOptions).toHaveBeenCalledTimes(2),
  );
  expect(result.current.options).toEqual([OPTION]);
  expect(result.current.actionError).toBe(
    ORG_MANAGER_LABELS.billingIdentityPending,
  );
  expect(result.current.canSubscribe).toBe(false);

  finishReload([OPTION]);
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
});

test("billing actions pause option retries and hide their stale error", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  let identityAttempts = 0;
  purchases.identify = mock(() => {
    identityAttempts += 1;
    return identityAttempts === 1
      ? Promise.reject(new PurchaseIdentityPendingError())
      : Promise.resolve();
  });
  let finishMove = () => {};
  purchases.moveNativeSubscription = mock(
    () =>
      new Promise<{ organizationId: string }>((resolve) => {
        finishMove = () => resolve({ organizationId: "restored-org" });
      }),
  );
  const { result } = renderBillingActions({
    optionsRetryDelaysMs: [200],
    purchases,
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(result.current.actionError).toBe(
    ORG_MANAGER_LABELS.billingIdentityPending,
  );

  act(() => result.current.confirmSubscriptionMove());
  await waitFor(() => expect(result.current.busy).toBe("restore"));
  expect(result.current.actionError).toBeNull();
  expect(result.current.optionsRetryAvailable).toBe(false);
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  // The native move owns its buyer selection inside the provider queue, so the
  // app-level options identity remains untouched while the move is active.
  expect(purchases.identify).toHaveBeenCalledTimes(1);
  expect(purchases.listSyncOptions).toHaveBeenCalledTimes(1);

  finishMove();
  await waitFor(() => expect(result.current.busy).toBeNull());
  await waitFor(() => expect(purchases.identify).toHaveBeenCalledTimes(2));
  expect(purchases.listSyncOptions).toHaveBeenCalledTimes(2);
});

test("revoking purchase eligibility clears options during a native action", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  let finishMove = () => {};
  purchases.moveNativeSubscription = mock(
    () =>
      new Promise<{ organizationId: string }>((resolve) => {
        finishMove = () => resolve({ organizationId: "restored-org" });
      }),
  );
  const { result, rerender } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.confirmSubscriptionMove());
  await waitFor(() => expect(result.current.busy).toBe("restore"));
  rerender({
    billingIsActive: false,
    isOrgAdmin: false,
    organizationId: "org-1",
    userId: "user-1",
  });

  await waitFor(() => expect(result.current.options).toEqual([]));
  expect(result.current.canSubscribe).toBe(false);
  finishMove();
  await waitFor(() => expect(result.current.busy).toBeNull());
});

test("billing actions do not reset an exhausted options retry budget", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  purchases.identify = mock(() =>
    Promise.reject(new PurchaseIdentityPendingError()),
  );
  let finishMove = () => {};
  purchases.moveNativeSubscription = mock(
    () =>
      new Promise<{ organizationId: string }>((resolve) => {
        finishMove = () => resolve({ organizationId: "restored-org" });
      }),
  );
  const { result } = renderBillingActions({
    optionsRetryDelaysMs: [100],
    purchases,
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.confirmSubscriptionMove());
  await waitFor(() => expect(result.current.busy).toBe("restore"));
  finishMove();
  await waitFor(() => expect(result.current.busy).toBeNull());
  await waitFor(() => expect(purchases.identify).toHaveBeenCalledTimes(2));
  await act(() => new Promise((resolve) => setTimeout(resolve, 120)));

  expect(purchases.identify).toHaveBeenCalledTimes(2);
});

test("a billing action does not hide an exhausted options error", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  purchases.listSyncOptions = mock(() =>
    Promise.reject(new PurchaseIdentityPendingError()),
  );
  const startTrial = mock(() => Promise.resolve(true));
  const { result } = renderBillingActions({
    optionsRetryDelaysMs: [],
    purchases,
    startTrial,
  });
  await waitFor(() =>
    expect(result.current.actionError).toBe(
      ORG_MANAGER_LABELS.billingIdentityPending,
    ),
  );

  act(() => result.current.startTrial());
  await waitFor(() => expect(result.current.busy).toBeNull());
  expect(result.current.actionError).toBe(
    ORG_MANAGER_LABELS.billingIdentityPending,
  );
  expect(result.current.optionsRetryAvailable).toBe(true);
  expect(result.current.canSubscribe).toBe(false);
});

test("stops retrying options after the configured schedule", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  let attempts = 0;
  purchases.listSyncOptions = mock(() => {
    attempts += 1;
    return attempts <= 3
      ? Promise.reject(new PurchaseIdentityPendingError())
      : Promise.resolve([OPTION]);
  });
  const { result } = renderBillingActions({
    optionsRetryDelaysMs: [0, 0],
    purchases,
  });

  await waitFor(() =>
    expect(purchases.listSyncOptions).toHaveBeenCalledTimes(3),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(purchases.listSyncOptions).toHaveBeenCalledTimes(3);
  expect(result.current.optionsRetryAvailable).toBe(true);

  act(() => result.current.retryOptions());
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(result.current.canSubscribe).toBe(true);
  expect(result.current.actionError).toBeNull();
  expect(result.current.optionsRetryAvailable).toBe(false);
});
