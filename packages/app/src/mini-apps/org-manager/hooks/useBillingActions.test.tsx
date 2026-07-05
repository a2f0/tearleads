import { afterEach, expect, mock, test } from "bun:test";
import type {
  PurchasesCapability,
  SyncPurchaseResult,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import {
  type CreatePurchasesFn,
  createAppHostConfig,
} from "../../../host/AppHostConfig";
import { AppHostConfigProvider } from "../../../providers/host/AppHostConfigProvider";
import { PurchasesProvider } from "../../../providers/purchases/PurchasesProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { useBillingActions } from "./useBillingActions";

afterEach(() => cleanup());

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
  billingCanSync?: boolean;
  purchases: PurchasesCapability;
  refresh?: () => Promise<void>;
}) {
  return renderHook(
    ({ billingCanSync }: { billingCanSync: boolean }) =>
      useBillingActions({
        billingCanSync,
        isOrgAdmin: true,
        organizationId: "org-1",
        refresh: input.refresh ?? (() => Promise.resolve()),
        startTrial: () => Promise.resolve(true),
        userId: "user-1",
      }),
    {
      initialProps: { billingCanSync: input.billingCanSync ?? false },
      wrapper: wrapper(() => input.purchases),
    },
  );
}

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

  rerender({ billingCanSync: true });

  await waitFor(() => expect(result.current.activationPending).toBe(false));
});
