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

test("a scope switch leaves a native purchase running", async () => {
  const purchaseResolvers: Array<(value: SyncPurchaseResult) => void> = [];
  const purchaseSync = mock(
    () =>
      new Promise<SyncPurchaseResult>((resolve) => {
        purchaseResolvers.push(resolve);
      }),
  );
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    // A native platform: the purchase runs in a store sheet the app cannot
    // cancel, so lifecycle changes must not settle it as cancelled.
    supportsEmbeddedCheckout: false,
    purchaseSync,
  };
  const { result, rerender } = renderBillingActions({ purchases });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(1));

  rerender({
    billingCanSync: false,
    organizationId: "org-1",
    userId: "user-2",
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(2));

  // The first (uncancelled) native purchase settling must not retire the
  // second flow — that retirement exists only for embedded checkouts whose
  // teardown wipes a shared host.
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

test("cancelCheckout settles the flow even while identification hangs", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    identify: mock(() => new Promise<void>(() => undefined)),
  };
  const { result } = renderBillingActions({ purchases });
  // Options never load (identify hangs), but subscribe is driven directly.
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
  expect(purchases.purchaseSync).not.toHaveBeenCalled();
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
