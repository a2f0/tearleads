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
  renderBillingActions,
} from "../../../../test/helpers/billingActionsTestKit";

afterEach(() => cleanup());

test("checkoutActive clears when the purchase settles, before the refresh", async () => {
  let resolveRefresh: (() => void) | undefined;
  const refresh = mock(
    () =>
      new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      }),
  );
  const purchases = createPurchases({ syncEntitlementActive: true });
  const { result } = renderBillingActions({ purchases, refresh });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });

  // The purchase settled; the billing refresh is still pending. The panel is
  // busy, but there is no checkout left to cancel.
  await waitFor(() =>
    expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`),
  );
  await waitFor(() => expect(result.current.checkoutActive).toBe(false));

  await act(async () => {
    resolveRefresh?.();
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
});

test("a purchase landing after cancellation still activates billing", async () => {
  const purchaseResolvers: Array<(value: SyncPurchaseResult) => void> = [];
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync: mock(
      () =>
        new Promise<SyncPurchaseResult>((resolve) => {
          purchaseResolvers.push(resolve);
        }),
    ),
  };
  const refresh = mock(() => Promise.resolve());
  const { result } = renderBillingActions({ purchases, refresh });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await act(async () => {
    result.current.cancelCheckout();
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.activationPending).toBe(false);

  // The provider had already taken the payment; its promise lands afterwards.
  await act(async () => {
    purchaseResolvers[0]?.({ syncEntitlementActive: true });
  });

  await waitFor(() => expect(result.current.activationPending).toBe(true));
  expect(refresh).toHaveBeenCalled();
});

test("a late success dismisses a newer checkout for the same scope", async () => {
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
  const replaceChildren = mock(() => undefined);
  const checkoutHost = { replaceChildren } as unknown as HTMLElement;
  const { result } = renderBillingActions({
    purchases,
    refresh,
    checkoutHostRef: { current: checkoutHost },
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  // First checkout is cancelled, then a second one starts for the same org.
  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await act(async () => {
    result.current.cancelCheckout();
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(2));

  // The first purchase lands after all: the second checkout is dismissed and
  // the landed purchase drives activation.
  await act(async () => {
    purchaseResolvers[0]?.({ syncEntitlementActive: true });
  });

  await waitFor(() => expect(result.current.busy).toBe(null));
  await waitFor(() => expect(result.current.activationPending).toBe(true));
  expect(result.current.actionError).toBe(null);
  expect(refresh).toHaveBeenCalled();
});

test("a stale flow's late settlement retires the newer flow cleanly", async () => {
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
  const { result, rerender } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(1));

  // Scope switch abandons the first purchase; a second one starts for the new
  // buyer (same org) while the first provider promise is still pending.
  rerender({
    billingCanSync: false,
    organizationId: "org-1",
    userId: "user-2",
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(2));

  // The first flow settles late: its provider teardown empties the shared
  // host, so the second flow is retired silently rather than left busy with
  // no visible checkout.
  await act(async () => {
    purchaseResolvers[0]?.({ syncEntitlementActive: false });
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.actionError).toBe(null);

  // The panel is still usable: a fresh checkout starts and can be cancelled.
  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(3));
  await act(async () => {
    result.current.cancelCheckout();
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.actionError).toBe(null);
});

test("a pre-mount abort settling late leaves the retry running", async () => {
  const purchaseHandlers: Array<{
    resolve: (value: SyncPurchaseResult) => void;
    reject: (error: Error) => void;
  }> = [];
  const purchaseSync = mock(
    () =>
      new Promise<SyncPurchaseResult>((resolve, reject) => {
        purchaseHandlers.push({ resolve, reject });
      }),
  );
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync,
  };
  const { result } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  // Cancel during the first purchase's pre-mount phase, then retry.
  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await act(async () => {
    result.current.cancelCheckout();
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(2));

  // The aborted purchase now rejects with the pre-checkout abort marker: no
  // checkout ever mounted, so nothing was torn down and the retry must keep
  // running rather than being retired.
  await act(async () => {
    purchaseHandlers[0]?.reject(new PurchaseAbortedError());
  });

  expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`);
  expect(result.current.actionError).toBe(null);
});

test("a mounted checkout's provider cancel retires the replacement", async () => {
  const purchaseHandlers: Array<{
    resolve: (value: SyncPurchaseResult) => void;
    reject: (error: Error) => void;
  }> = [];
  const purchaseSync = mock(
    () =>
      new Promise<SyncPurchaseResult>((resolve, reject) => {
        purchaseHandlers.push({ resolve, reject });
      }),
  );
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync,
  };
  const { result } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await act(async () => {
    result.current.cancelCheckout();
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(2));

  // The base cancellation (unlike PurchaseAbortedError) means the abandoned
  // checkout HAD mounted and the provider tore it down — emptying the shared
  // host — so the replacement is retired instead of sitting busy with no UI.
  await act(async () => {
    purchaseHandlers[0]?.reject(new PurchaseCancelledError());
  });

  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.actionError).toBe(null);
});

test("a late failure of a cancelled checkout retires its replacement", async () => {
  const purchaseHandlers: Array<{
    resolve: (value: SyncPurchaseResult) => void;
    reject: (error: Error) => void;
  }> = [];
  const purchaseSync = mock(
    () =>
      new Promise<SyncPurchaseResult>((resolve, reject) => {
        purchaseHandlers.push({ resolve, reject });
      }),
  );
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync,
  };
  const replaceChildren = mock(() => undefined);
  const checkoutHost = { replaceChildren } as unknown as HTMLElement;
  const { result } = renderBillingActions({
    purchases,
    checkoutHostRef: { current: checkoutHost },
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  // First checkout is cancelled, a replacement starts in the same host.
  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await act(async () => {
    result.current.cancelCheckout();
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(2));

  // The first flow's late failure tears down the shared host; the
  // replacement must settle instead of sitting busy with no visible UI.
  await act(async () => {
    purchaseHandlers[0]?.reject(new Error("payment failed after dismissal"));
  });

  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.actionError).toBe(null);
});
