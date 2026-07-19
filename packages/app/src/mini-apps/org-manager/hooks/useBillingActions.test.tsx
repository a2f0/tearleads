import { afterEach, expect, mock, test } from "bun:test";
import {
  PurchaseCancelledError,
  type PurchasesCapability,
  type SyncPurchaseResult,
  type SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren, RefObject } from "react";
import {
  type CreatePurchasesFn,
  createAppHostConfig,
} from "../../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import { PurchasesProvider } from "../../../providers/purchases/PurchasesProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { useBillingActions } from "./useBillingActions";

afterEach(() => cleanup());

/** Disables post-purchase polling by default so existing tests are unaffected. */
const NO_POLL: readonly number[] = [];

const OPTION: SyncSubscriptionOption = {
  packageId: "monthly",
  productId: "sync_monthly",
  title: "Sync",
  description: "Cloud sync",
  priceLabel: "$4.99",
};

function createPurchases(
  purchaseResult: SyncPurchaseResult,
): PurchasesCapability {
  return {
    isAvailable: true,
    identify: mock(() => Promise.resolve()),
    reset: mock(() => Promise.resolve()),
    listSyncOptions: mock(() => Promise.resolve([OPTION])),
    purchaseSync: mock(() => Promise.resolve(purchaseResult)),
    restore: mock(() => Promise.resolve()),
    hasActiveSyncEntitlement: mock(() => Promise.resolve(false)),
  };
}

function wrapper(createPurchasesFn: CreatePurchasesFn) {
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://localhost",
    createPurchases: createPurchasesFn,
    wsUrl: "ws://localhost",
  });

  return function BillingActionsWrapper({ children }: PropsWithChildren) {
    return (
      <AppHostConfigProvider value={hostConfig}>
        <PurchasesProvider>{children}</PurchasesProvider>
      </AppHostConfigProvider>
    );
  };
}

function renderBillingActions(input: {
  activationPollDelaysMs?: readonly number[];
  billingCanSync?: boolean;
  checkoutHostRef?: RefObject<HTMLElement | null>;
  purchases: PurchasesCapability;
  refresh?: () => Promise<void>;
  startTrial?: () => Promise<boolean>;
}) {
  return renderHook(
    ({
      billingCanSync,
      organizationId,
      userId,
    }: {
      billingCanSync: boolean;
      organizationId: string;
      userId: string;
    }) =>
      useBillingActions({
        activationPollDelaysMs: input.activationPollDelaysMs ?? NO_POLL,
        billingCanSync,
        ...(input.checkoutHostRef
          ? { checkoutHostRef: input.checkoutHostRef }
          : {}),
        isOrgAdmin: true,
        organizationId,
        refresh: input.refresh ?? (() => Promise.resolve()),
        startTrial: input.startTrial ?? (() => Promise.resolve(true)),
        userId,
      }),
    {
      initialProps: {
        billingCanSync: input.billingCanSync ?? false,
        organizationId: "org-1",
        userId: "user-1",
      },
      wrapper: wrapper(() => input.purchases),
    },
  );
}

test("identifies the buyer before loading subscription options", async () => {
  const calls: string[] = [];
  const purchases: PurchasesCapability = {
    isAvailable: true,
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
    restore: mock(() => Promise.resolve()),
    hasActiveSyncEntitlement: mock(() => Promise.resolve(false)),
  };

  const { result } = renderBillingActions({ purchases });

  await waitFor(() => expect(result.current.options).toEqual([OPTION]));
  expect(calls).toEqual(["identify", "listSyncOptions"]);
  expect(purchases.identify).toHaveBeenCalledWith({ userId: "user-1" });
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

test("clears activation pending once refreshed billing can sync", async () => {
  const purchases = createPurchases({ syncEntitlementActive: true });
  const { result, rerender } = renderBillingActions({ purchases });

  await act(async () => {
    result.current.subscribe(OPTION);
  });

  await waitFor(() => expect(result.current.activationPending).toBe(true));

  rerender({
    billingCanSync: true,
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
  const oldRestore = result.current.restore;

  rerender({
    billingCanSync: false,
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
    billingCanSync: false,
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

  rerender({
    billingCanSync: false,
    organizationId: "org-2",
    userId: "user-1",
  });
  expect(result.current.busy).toBe(null);
  expect(result.current.actionError).toBe(null);
  expect(result.current.activationPending).toBe(false);

  act(() => result.current.subscribe(OPTION));
  await waitFor(() => expect(purchaseSync).toHaveBeenCalledTimes(2));
  expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`);
  expect(purchaseSync).toHaveBeenNthCalledWith(1, {
    organizationId: "org-1",
    packageId: OPTION.packageId,
  });
  expect(purchaseSync).toHaveBeenNthCalledWith(2, {
    organizationId: "org-2",
    packageId: OPTION.packageId,
  });

  await act(async () => {
    purchaseResolvers[0]?.({ syncEntitlementActive: false });
  });
  expect(result.current.busy).toBe(`subscribe:${OPTION.packageId}`);
  expect(result.current.actionError).toBe(null);
  expect(refresh).not.toHaveBeenCalled();

  await act(async () => {
    purchaseResolvers[1]?.({ syncEntitlementActive: true });
  });
  await waitFor(() => expect(result.current.busy).toBe(null));
  expect(result.current.activationPending).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(1);
});

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

test("polls billing after a successful purchase until the org can sync", async () => {
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
  // billing while the org is not yet syncable (the webhook has not landed).
  await waitFor(() => expect(result.current.activationPending).toBe(true));
  await waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThan(1));

  // Once billing reports the org can sync, the pending flag clears and polling
  // stops — the refresh count no longer grows.
  rerender({
    billingCanSync: true,
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
