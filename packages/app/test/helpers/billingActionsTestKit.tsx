import { mock } from "bun:test";
import type {
  PurchasesCapability,
  SyncPurchaseResult,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren, RefObject } from "react";
import {
  type CreatePurchasesFn,
  createAppHostConfig,
} from "../../src/host/AppHostConfig";
import {
  type BillingActions,
  useBillingActions,
} from "../../src/mini-apps/org-manager/hooks/useBillingActions";
import { AppHostConfigProvider } from "../../src/providers/host/AppHostConfigProvider";
import { LogProvider } from "../../src/providers/logging/LogProvider";
import { PurchasesProvider } from "../../src/providers/purchases/PurchasesProvider";

/** Disables post-purchase polling by default so tests are unaffected. */
const NO_POLL: readonly number[] = [];

export const OPTION: SyncSubscriptionOption = {
  packageId: "monthly",
  productId: "sync_monthly",
  title: "Sync",
  description: "Cloud sync",
  priceLabel: "$4.99",
};

export function createPurchases(
  purchaseResult: SyncPurchaseResult,
): PurchasesCapability {
  return {
    isAvailable: true,
    supportsEmbeddedCheckout: true,
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
        <PurchasesProvider>
          <LogProvider>{children}</LogProvider>
        </PurchasesProvider>
      </AppHostConfigProvider>
    );
  };
}

export function renderBillingActions(input: {
  activationPollDelaysMs?: readonly number[];
  billingCanSync?: boolean;
  checkoutHostRef?: RefObject<HTMLElement | null>;
  purchases: PurchasesCapability;
  refresh?: () => Promise<void>;
  startTrial?: () => Promise<boolean>;
}) {
  return renderHook<
    BillingActions,
    {
      billingCanSync: boolean;
      isOrgAdmin?: boolean;
      organizationId: string;
      userId: string;
    }
  >(
    ({ billingCanSync, isOrgAdmin, organizationId, userId }) =>
      useBillingActions({
        activationPollDelaysMs: input.activationPollDelaysMs ?? NO_POLL,
        billingCanSync,
        ...(input.checkoutHostRef
          ? { checkoutHostRef: input.checkoutHostRef }
          : {}),
        isOrgAdmin: isOrgAdmin ?? true,
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
