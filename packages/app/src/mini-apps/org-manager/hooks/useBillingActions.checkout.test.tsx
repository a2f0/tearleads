import { afterEach, expect, mock, test } from "bun:test";
import {
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

test("subscribe embeds the checkout in the mounted host element", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  const checkoutHost = { id: "checkout-host" } as unknown as HTMLElement;
  const { result } = renderBillingActions({
    purchases,
    checkoutHostRef: { current: checkoutHost },
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });

  await waitFor(() =>
    expect(purchases.purchaseSync).toHaveBeenCalledWith({
      organizationId: "org-1",
      packageId: OPTION.packageId,
      checkoutHost,
    }),
  );
});

test("cancelCheckout settles a hung purchase silently and empties the host", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    // A purchase that never settles on its own — the embedded checkout is
    // waiting for the buyer, and the SDK promise only resolves via its UI.
    purchaseSync: mock(() => new Promise<SyncPurchaseResult>(() => undefined)),
  };
  const replaceChildren = mock(() => undefined);
  const checkoutHost = { replaceChildren } as unknown as HTMLElement;
  const { result } = renderBillingActions({
    purchases,
    checkoutHostRef: { current: checkoutHost },
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() =>
    expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`),
  );

  await act(async () => {
    result.current.cancelCheckout();
  });

  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.actionError).toBe(null);
  expect(result.current.activationPending).toBe(false);
  expect(replaceChildren).toHaveBeenCalledTimes(1);
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

test("a scope switch cancels the in-flight embedded checkout", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync: mock(() => new Promise<SyncPurchaseResult>(() => undefined)),
  };
  const replaceChildren = mock(() => undefined);
  const checkoutHost = { replaceChildren } as unknown as HTMLElement;
  const { result, rerender } = renderBillingActions({
    purchases,
    checkoutHostRef: { current: checkoutHost },
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() =>
    expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`),
  );

  rerender({
    billingCanSync: false,
    organizationId: "org-1",
    userId: "user-2",
  });

  await waitFor(() => expect(replaceChildren).toHaveBeenCalledTimes(1));
});

test("unmounting the panel cancels the in-flight embedded checkout", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync: mock(() => new Promise<SyncPurchaseResult>(() => undefined)),
  };
  const replaceChildren = mock(() => undefined);
  const checkoutHost = { replaceChildren } as unknown as HTMLElement;
  const { result, unmount } = renderBillingActions({
    purchases,
    checkoutHostRef: { current: checkoutHost },
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() =>
    expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`),
  );

  unmount();

  await waitFor(() => expect(replaceChildren).toHaveBeenCalledTimes(1));
});

test("a stale flow's cleanup keeps the newer flow cancellable", async () => {
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
  // buyer while the first provider promise is still pending.
  rerender({
    billingCanSync: false,
    organizationId: "org-1",
    userId: "user-2",
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(2));

  // The first flow settles (no entitlement) and runs its cleanup. It must not
  // strip the second flow's cancel action.
  await act(async () => {
    purchaseResolvers[0]?.({ syncEntitlementActive: false });
  });
  expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`);

  await act(async () => {
    result.current.cancelCheckout();
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.actionError).toBe(null);
});

test("cancelCheckout is a no-op with no purchase in flight", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  const { result } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => {
    result.current.cancelCheckout();
  });

  expect(result.current.busy).toBe(null);
  expect(result.current.actionError).toBe(null);
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
});
