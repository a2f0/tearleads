import { afterEach, expect, mock, test } from "bun:test";
import type {
  PurchasesCapability,
  SyncPurchaseResult,
} from "@tearleads/client-sdk";
import { PurchaseAlreadyOwnedError } from "@tearleads/client-sdk";
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
    restore: mock(() => Promise.resolve({ syncEntitlementActive: true })),
    hasActiveSyncEntitlement: mock(() => Promise.resolve(false)),
  };

  const { result } = renderBillingActions({ purchases });

  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(calls).toEqual(["identify", "listSyncOptions"]);
  expect(purchases.identify).toHaveBeenCalledWith({ userId: "user-1" });
});

test("does not identify or offer native purchases for a custom organization", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  const { result } = renderBillingActions({
    nativePurchaseAllowed: false,
    purchases,
  });

  expect(result.current.canSubscribe).toBe(false);
  expect(result.current.options).toEqual([]);
  expect(purchases.identify).not.toHaveBeenCalled();
  act(() => result.current.subscribe(OPTION));
  expect(purchases.purchaseSync).not.toHaveBeenCalled();
});

test("does not mark activation pending when purchase returns no sync entitlement", async () => {
  const purchases = createPurchases({ syncEntitlementActive: false });
  const refresh = mock(() => Promise.resolve());
  const { result } = renderBillingActions({ purchases, refresh });

  await act(async () => {
    result.current.subscribe(OPTION);
  });

  await waitFor(() =>
    expect(result.current.actionError).toBe(ORG_MANAGER_LABELS.failedSubscribe),
  );
  expect(result.current.activationPending).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
});

test("clears purchase pending once the paid tier becomes effective", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  const { result, rerender } = renderBillingActions({ purchases });

  await act(async () => {
    result.current.subscribe(OPTION);
  });

  await waitFor(() => expect(result.current.activationPending).toBe(true));

  rerender({
    billingIsActive: true,
    billingSeatCount: OPTION.seatLimit,
    organizationId: "org-1",
    userId: "user-1",
  });

  await waitFor(() => expect(result.current.activationPending).toBe(false));
});

test("ignores an old organization's action callbacks after a switch", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  const startTrial = mock(() => Promise.resolve(true));
  const { result, rerender } = renderBillingActions({
    purchases,
    startTrial,
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  const oldStartTrial = result.current.startTrial;
  const oldSubscribe = result.current.subscribe;
  const oldRestore = result.current.confirmSubscriptionMove;

  rerender({
    billingIsActive: false,
    organizationId: "org-2",
    userId: "user-1",
  });
  act(() => {
    oldStartTrial();
    oldSubscribe(OPTION);
    oldRestore();
  });

  expect(startTrial).not.toHaveBeenCalled();
  expect(purchases.purchaseSync).not.toHaveBeenCalled();
  expect(purchases.restore).not.toHaveBeenCalled();
  expect(result.current.busy).toBe(null);
  expect(result.current.actionError).toBe(null);
  expect(result.current.activationPending).toBe(false);
});

test("restores and claims a native subscription only after confirmation", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  const claimNativeSubscription = mock(() => Promise.resolve(true));
  const refresh = mock(() => Promise.resolve());
  const { result } = renderBillingActions({
    claimNativeSubscription,
    purchases,
    refresh,
  });

  act(() => result.current.requestSubscriptionMove());
  expect(result.current.subscriptionMoveOpen).toBe(true);
  expect(purchases.restore).not.toHaveBeenCalled();

  act(() => result.current.confirmSubscriptionMove());
  await waitFor(() => expect(result.current.busy).toBeNull());
  expect(purchases.restore).toHaveBeenCalledWith();
  expect(claimNativeSubscription).toHaveBeenCalledWith("test_store");
  expect(purchases.bindOrganization).toHaveBeenCalledWith({
    organizationId: "org-1",
  });
  expect(refresh).toHaveBeenCalled();
});

test("an already-owned purchase offers the same explicit move flow", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  purchases.purchaseSync = mock(() =>
    Promise.reject(new PurchaseAlreadyOwnedError()),
  );
  const { result } = renderBillingActions({ purchases });

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(result.current.subscriptionMoveOpen).toBe(true));
  expect(result.current.actionError).toBeNull();
});

test("a same-org user switch invalidates in-flight purchase identification", async () => {
  const identifyResolvers: Array<() => void> = [];
  const identify = mock(
    () =>
      new Promise<void>((resolve) => {
        identifyResolvers.push(resolve);
      }),
  );
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    identify,
  };
  const { result, rerender } = renderBillingActions({ purchases });
  await waitFor(() => expect(identify).toHaveBeenCalledTimes(1));
  await act(async () => identifyResolvers[0]?.());
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(identify).toHaveBeenCalledTimes(2));
  expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`);

  rerender({
    billingIsActive: false,
    organizationId: "org-1",
    userId: "user-2",
  });
  expect(result.current.busy).toBe(null);
  expect(result.current.actionError).toBe(null);
  expect(result.current.activationPending).toBe(false);
  await waitFor(() => expect(identify).toHaveBeenCalledTimes(3));

  await act(async () => identifyResolvers[1]?.());
  expect(purchases.purchaseSync).not.toHaveBeenCalled();
  await act(async () => identifyResolvers[2]?.());
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(identify).toHaveBeenNthCalledWith(2, { userId: "user-1" });
  expect(identify).toHaveBeenNthCalledWith(3, { userId: "user-2" });
});

test("an old purchase completion cannot commit into or clear the new org", async () => {
  const purchaseResolvers: Array<(value: SyncPurchaseResult) => void> = [];
  const purchaseSync = mock(
    () =>
      new Promise<SyncPurchaseResult>((resolve) => {
        purchaseResolvers.push(resolve);
      }),
  );
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync,
  };
  const refresh = mock(() => Promise.resolve());
  const { result, rerender } = renderBillingActions({ purchases, refresh });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(1));

  // The switch abandons org-1's purchase. An org-2 purchase may start right
  // away: each purchase carries its org in immutable transaction metadata
  // (see client-sdk purchaseSync), so a late completion of org-1's purchase
  // cannot be attributed to org-2.
  rerender({
    billingIsActive: false,
    organizationId: "org-2",
    userId: "user-1",
  });
  expect(result.current.busy).toBe(null);
  expect(result.current.activationPending).toBe(false);

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(2));
  expect(purchaseSync).toHaveBeenNthCalledWith(1, {
    organizationId: "org-1",
    packageId: OPTION.packageId,
    abortSignal: expect.any(AbortSignal),
  });
  expect(purchaseSync).toHaveBeenNthCalledWith(2, {
    organizationId: "org-2",
    packageId: OPTION.packageId,
    abortSignal: expect.any(AbortSignal),
  });

  // Org-1's abandoned purchase settling without an entitlement must neither
  // commit into org-2's state nor disturb org-2's still-running flow.
  await act(async () => {
    purchaseResolvers[0]?.({ syncEntitlementActive: false });
  });
  expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`);
  expect(result.current.actionError).toBe(null);
  expect(result.current.activationPending).toBe(false);
  expect(refresh).not.toHaveBeenCalled();

  await act(async () => {
    purchaseResolvers[1]?.({ syncEntitlementActive: true });
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.activationPending).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("polls billing after a successful purchase until the tier is reflected", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  const refresh = mock(() => Promise.resolve());
  const { result, rerender } = renderBillingActions({
    purchases,
    refresh,
    activationPollDelaysMs: [5, 5, 5, 5],
  });

  await act(async () => {
    result.current.subscribe(OPTION);
  });

  // The immediate post-purchase read plus the backoff poll keep re-reading
  // billing while the provider webhook has not landed.
  await waitFor(() => expect(result.current.activationPending).toBe(true));
  await waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThan(1));

  // Once billing reports the purchased tier, the pending flag clears and
  // polling stops — the refresh count no longer grows.
  rerender({
    billingIsActive: true,
    billingSeatCount: OPTION.seatLimit,
    organizationId: "org-1",
    userId: "user-1",
  });
  await waitFor(() => expect(result.current.activationPending).toBe(false));
  const callsAfterActive = refresh.mock.calls.length;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  expect(refresh.mock.calls.length).toBe(callsAfterActive);
});

test("a scheduled downgrade also settles the post-purchase poll", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  const { result, rerender } = renderBillingActions({
    billingIsActive: true,
    billingSeatCount: 5,
    purchases,
  });

  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() => expect(result.current.activationPending).toBe(true));

  rerender({
    billingIsActive: true,
    billingPendingSeatCount: OPTION.seatLimit,
    billingSeatCount: 5,
    organizationId: "org-1",
    userId: "user-1",
  });
  await waitFor(() => expect(result.current.activationPending).toBe(false));
});

test("an immediate upgrade keeps polling until its capacity is effective", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  const teamOption = {
    ...OPTION,
    packageId: "team-5-monthly",
    productId: "sync_team_5_monthly",
    seatLimit: 5,
    tierId: "team_5" as const,
  };
  const { result, rerender } = renderBillingActions({
    billingIsActive: true,
    billingSeatCount: OPTION.seatLimit,
    purchases,
  });

  await act(async () => {
    result.current.subscribe(teamOption);
  });
  await waitFor(() => expect(result.current.activationPending).toBe(true));

  rerender({
    billingIsActive: true,
    billingPendingSeatCount: teamOption.seatLimit,
    billingSeatCount: OPTION.seatLimit,
    organizationId: "org-1",
    userId: "user-1",
  });
  expect(result.current.activationPending).toBe(true);

  rerender({
    billingIsActive: true,
    billingSeatCount: teamOption.seatLimit,
    organizationId: "org-1",
    userId: "user-1",
  });
  await waitFor(() => expect(result.current.activationPending).toBe(false));
});
