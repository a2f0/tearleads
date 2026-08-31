import { mock } from "bun:test";
import type {
  PurchasesCapability,
  SessionCreateOrganizationResult,
  SyncPurchaseResult,
  SyncSubscriptionOption,
} from "@symcrypt/client-sdk";
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

export const RESTORE_ORGANIZATION: SessionCreateOrganizationResult = {
  containerId: "restored-root",
  organizationId: "restored-org",
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
        if (!purchaseResult.syncEntitlementActive) {
          throw new Error("The restored receipt has no sync entitlement");
        }
        const organizationId = await input.claim("test_store");
        if (!organizationId) {
          throw new Error("The server did not accept the native subscription");
        }
        await purchases.bindOrganization({
          organizationId,
        });
        return { organizationId };
      },
    ),
    purchaseSync: mock(() => Promise.resolve(purchaseResult)),
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
  activateRestoredOrganization?: (
    organization: SessionCreateOrganizationResult,
  ) => void;
  claimNativeSubscription?: (organizationId: string) => Promise<boolean>;
  createRestoreOrganization?: () => Promise<SessionCreateOrganizationResult | null>;
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
        activateRestoredOrganization:
          input.activateRestoredOrganization ?? (() => undefined),
        activationPollDelaysMs: input.activationPollDelaysMs ?? NO_POLL,
        billingIsActive,
        billingPendingSeatCount: billingPendingSeatCount ?? null,
        billingSeatCount: billingSeatCount ?? null,
        claimNativeSubscription:
          input.claimNativeSubscription ?? (() => Promise.resolve(true)),
        ...(input.checkoutHostRef
          ? { checkoutHostRef: input.checkoutHostRef }
          : {}),
        createRestoreOrganization:
          input.createRestoreOrganization ??
          (() => Promise.resolve(RESTORE_ORGANIZATION)),
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
