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
import { DirectCheckoutProvider } from "../../src/providers/direct-checkout/DirectCheckoutProvider";
import { AppHostConfigProvider } from "../../src/providers/host/AppHostConfigProvider";
import { LogProvider, useLog } from "../../src/providers/logging/LogProvider";
import { PurchasesProvider } from "../../src/providers/purchases/PurchasesProvider";

/** Suspends post-purchase polling by default so tests can drive settlement. */
const NO_POLL: readonly number[] = [60_000];

export const OPTION: SyncSubscriptionOption = {
  tierId: "solo",
  seatLimit: 1,
  packageId: "monthly",
  productId: "sync_monthly",
  title: "Sync",
  description: "Cloud sync",
  priceLabel: "$4.99",
};

type BillingTraceEntry = {
  level: "error" | "info";
  message: string;
};

export function purchaseTraceEntries(
  entries: ReadonlyArray<BillingTraceEntry>,
): BillingTraceEntry[] {
  return entries.filter(({ message }) =>
    message.startsWith("billing purchase "),
  );
}

export function createPurchases(
  purchaseResult: SyncPurchaseResult,
): PurchasesCapability {
  const purchases: PurchasesCapability = {
    bindOrganization: mock(() => Promise.resolve()),
    isAvailable: true,
    nativeStore: "test_store",
    supportsEmbeddedCheckout: true,
    identify: mock(() => Promise.resolve()),
    reset: mock(() => Promise.resolve()),
    listSyncOptions: mock(() => Promise.resolve([OPTION])),
    moveNativeSubscription: mock(
      async (
        input: Parameters<PurchasesCapability["moveNativeSubscription"]>[0],
      ) => {
        const restored = await purchases.restore();
        if (!restored.syncEntitlementActive) {
          throw new Error("The restored receipt has no sync entitlement");
        }
        if (!(await input.claim("test_store"))) {
          throw new Error("The server did not accept the native subscription");
        }
        await purchases.bindOrganization({
          organizationId: input.organizationId,
        });
      },
    ),
    purchaseSync: mock(() => Promise.resolve(purchaseResult)),
    restore: mock(() => Promise.resolve({ syncEntitlementActive: true })),
    hasActiveSyncEntitlement: mock(() => Promise.resolve(false)),
  };
  return purchases;
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
          <DirectCheckoutProvider>
            <LogProvider>{children}</LogProvider>
          </DirectCheckoutProvider>
        </PurchasesProvider>
      </AppHostConfigProvider>
    );
  };
}

export function renderBillingActions(input: {
  activationPollDelaysMs?: readonly number[];
  billingIsActive?: boolean;
  billingPendingSeatCount?: number | null;
  billingSeatCount?: number | null;
  checkoutHostRef?: RefObject<HTMLElement | null>;
  purchases: PurchasesCapability;
  nativePurchaseAllowed?: boolean;
  optionsRetryDelaysMs?: readonly number[];
  claimNativeSubscription?: () => Promise<boolean>;
  refresh?: () => Promise<void>;
  startTrial?: () => Promise<boolean>;
}) {
  return renderHook<
    BillingActions & {
      logEntries: ReadonlyArray<{
        level: "error" | "info";
        message: string;
      }>;
    },
    {
      billingIsActive: boolean;
      billingPendingSeatCount?: number | null;
      billingSeatCount?: number | null;
      isOrgAdmin?: boolean;
      organizationId: string;
      userId: string;
    }
  >(
    ({
      billingIsActive,
      billingPendingSeatCount,
      billingSeatCount,
      isOrgAdmin,
      organizationId,
      userId,
    }) => {
      const actions = useBillingActions({
        activationPollDelaysMs: input.activationPollDelaysMs ?? NO_POLL,
        billingIsActive,
        billingPendingSeatCount: billingPendingSeatCount ?? null,
        billingSeatCount: billingSeatCount ?? null,
        claimNativeSubscription:
          input.claimNativeSubscription ?? (() => Promise.resolve(true)),
        ...(input.checkoutHostRef
          ? { checkoutHostRef: input.checkoutHostRef }
          : {}),
        isOrgAdmin: isOrgAdmin ?? true,
        nativePurchaseAllowed: input.nativePurchaseAllowed ?? true,
        ...(input.optionsRetryDelaysMs
          ? { optionsRetryDelaysMs: input.optionsRetryDelaysMs }
          : {}),
        organizationId,
        refresh: input.refresh ?? (() => Promise.resolve()),
        startTrial: input.startTrial ?? (() => Promise.resolve(true)),
        userId,
      });
      const { entries } = useLog();
      return {
        ...actions,
        logEntries: entries.map(({ level, message }) => ({ level, message })),
      };
    },
    {
      initialProps: {
        billingIsActive: input.billingIsActive ?? false,
        billingPendingSeatCount: input.billingPendingSeatCount ?? null,
        billingSeatCount: input.billingSeatCount ?? null,
        organizationId: "org-1",
        userId: "user-1",
      },
      wrapper: wrapper(() => input.purchases),
    },
  );
}
