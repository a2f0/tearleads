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
    { level: "info", message: "billing purchase stage=identified" },
    { level: "info", message: "billing purchase stage=provider-started" },
    {
      level: "error",
      message:
        "billing purchase stage=failed code=product-unavailable native=none userCancelled=unknown",
    },
  ]);
});

test("subscribe embeds the checkout in a child of the host element", async () => {
  let purchaseInput:
    | { organizationId: string; checkoutHost?: HTMLElement }
    | undefined;
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync: mock((input: typeof purchaseInput & object) => {
      purchaseInput = input;
      return new Promise<SyncPurchaseResult>(() => undefined);
    }) as PurchasesCapability["purchaseSync"],
  };
  const checkoutHost = document.createElement("div");
  const { result } = renderBillingActions({
    purchases,
    checkoutHostRef: { current: checkoutHost },
  });
  await waitFor(() => expect(result.current.options).toEqual([OPTION]));

  await act(async () => {
    result.current.subscribe(OPTION);
  });

  // The purchase mounts into a per-attempt child so an abandoned attempt's
  // teardown can never wipe a replacement's UI.
  await waitFor(() => expect(purchaseInput).toBeDefined());
  expect(purchaseInput?.organizationId).toBe("org-1");
  expect(purchaseInput?.checkoutHost).toBe(
    checkoutHost.firstElementChild as HTMLElement,
  );
});

test("cancelCheckout settles a hung purchase silently and empties the host", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    // A purchase that never settles on its own — the embedded checkout is
    // waiting for the buyer, and the SDK promise only resolves via its UI.
    purchaseSync: mock(() => new Promise<SyncPurchaseResult>(() => undefined)),
  };
  const checkoutHost = document.createElement("div");
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
  // The attempt got its own child host inside the panel's host element.
  expect(checkoutHost.childElementCount).toBe(1);

  await act(async () => {
    result.current.cancelCheckout();
  });

  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.actionError).toBe(null);
  expect(result.current.activationPending).toBe(false);
  expect(checkoutHost.childElementCount).toBe(0);
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
    billingIsActive: false,
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

test("a scope switch during native identification emits a terminal trace", async () => {
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
    supportsEmbeddedCheckout: false,
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
    { level: "info", message: "billing purchase stage=identified" },
    { level: "info", message: "billing purchase stage=superseded" },
  ]);
});

test("a scope switch cancels the in-flight embedded checkout", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync: mock(() => new Promise<SyncPurchaseResult>(() => undefined)),
  };
  const checkoutHost = document.createElement("div");
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
    billingIsActive: false,
    organizationId: "org-1",
    userId: "user-2",
  });

  await waitFor(() => expect(checkoutHost.childElementCount).toBe(0));
});

test("losing purchase eligibility cancels the in-flight embedded checkout", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync: mock(() => new Promise<SyncPurchaseResult>(() => undefined)),
  };
  const checkoutHost = document.createElement("div");
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
    billingIsActive: false,
    isOrgAdmin: false,
    organizationId: "org-1",
    userId: "user-1",
  });

  await waitFor(() => expect(checkoutHost.childElementCount).toBe(0));
});

test("unmounting the panel cancels the in-flight embedded checkout", async () => {
  const purchases: PurchasesCapability = {
    ...createPurchases({ syncEntitlementActive: true }),
    purchaseSync: mock(() => new Promise<SyncPurchaseResult>(() => undefined)),
  };
  const checkoutHost = document.createElement("div");
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

  await waitFor(() => expect(checkoutHost.childElementCount).toBe(0));
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
  expect(purchaseTraceEntries(result.current.logEntries)).toEqual([
    { level: "info", message: "billing purchase stage=started" },
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
test("marking activation pending flags the org and starts the poll", async () => {
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

  expect(result.current.activationPending).toBe(true);
  await waitFor(() =>
    expect(refresh.mock.calls.length).toBeGreaterThan(refreshesBefore),
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
