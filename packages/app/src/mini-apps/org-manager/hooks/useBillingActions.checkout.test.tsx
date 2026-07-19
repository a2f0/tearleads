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
      abortSignal: expect.any(AbortSignal),
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

test("losing purchase eligibility cancels the in-flight embedded checkout", async () => {
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

  // The buyer's admin role is revoked mid-purchase: the admin actions (and
  // the checkout host inside them) unmount, so the purchase must be
  // cancelled rather than left attached to a detached element.
  rerender({
    billingCanSync: false,
    isOrgAdmin: false,
    organizationId: "org-1",
    userId: "user-1",
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

test("a cancel before the checkout mounts aborts the purchase signal", async () => {
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
  const { result } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });
  await waitFor(() => expect(purchaseSignals).toHaveLength(1));
  expect(purchaseSignals[0]?.aborted).toBe(false);

  // Cancelling must abort the signal so a purchase still in its pre-checkout
  // phase (offerings fetch etc.) never mounts a checkout nobody controls.
  await act(async () => {
    result.current.cancelCheckout();
  });

  expect(purchaseSignals[0]?.aborted).toBe(true);
  await waitFor(() => expect(result.current.busy).toBe(null));
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

  // The aborted purchase now rejects with the backend's cancellation: no
  // checkout ever mounted, so nothing was torn down and the retry must keep
  // running rather than being retired.
  await act(async () => {
    purchaseHandlers[0]?.reject(new PurchaseCancelledError());
  });

  expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`);
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
