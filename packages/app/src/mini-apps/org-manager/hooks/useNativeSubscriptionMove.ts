import {
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  type PurchasesCapability,
} from "@symcrypt/client-sdk";
import type { NativeSubscriptionStore } from "@symcrypt/validators/billing";
import { useCallback, useEffect, useState } from "react";
import { useLog } from "../../../providers/logging/LogProvider";
import { formatBillingPurchaseFailure } from "../../../utils/billingPurchaseTrace";
import {
  type BillingActionScope,
  type BillingScopeRef,
  scopeMatches,
  type UpdateActionState,
} from "../billing/billingActionScope";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  type CheckNativePurchaseEligibility,
  nativePurchaseEligibilityErrorLabel,
  requireNativePurchaseEligibility,
} from "./nativePurchaseEligibility";

interface UseNativeSubscriptionMoveInput {
  readonly checkNativePurchaseEligibility: CheckNativePurchaseEligibility;
  readonly claimNativeSubscription: (
    store: NativeSubscriptionStore,
  ) => Promise<boolean>;
  readonly currentScope: BillingActionScope;
  readonly nativePurchaseAllowed: boolean;
  readonly purchases: PurchasesCapability;
  readonly refresh: () => Promise<void>;
  readonly scopeRef: BillingScopeRef;
  readonly updateActionState: UpdateActionState;
  readonly userId: string | null;
}

function nativeSubscriptionClaimErrorLabel(error: unknown): string {
  const eligibilityLabel = nativePurchaseEligibilityErrorLabel(error);
  if (eligibilityLabel) return eligibilityLabel;
  if (error instanceof PurchaseProviderStalledError) {
    return ORG_MANAGER_LABELS.billingProviderStalled;
  }
  if (error instanceof PurchaseIdentityPendingError) {
    return ORG_MANAGER_LABELS.billingIdentityPending;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "native-claim-timeout"
  ) {
    return ORG_MANAGER_LABELS.nativeClaimTimedOut;
  }
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return ORG_MANAGER_LABELS.failedRestorePurchases;
  }
  if (error.status === 404) return ORG_MANAGER_LABELS.nativeClaimNotFound;
  if (error.status === 409) return ORG_MANAGER_LABELS.nativeClaimConflict;
  if (error.status === 503) return ORG_MANAGER_LABELS.nativeClaimPending;
  return ORG_MANAGER_LABELS.failedRestorePurchases;
}

async function restoreClaimAndBindNativeSubscription(input: {
  readonly checkNativePurchaseEligibility: CheckNativePurchaseEligibility;
  readonly claimNativeSubscription: (
    store: NativeSubscriptionStore,
  ) => Promise<boolean>;
  readonly purchases: PurchasesCapability;
  readonly scope: BillingActionScope;
  readonly userId: string | null;
}): Promise<void> {
  if (!input.userId || !input.purchases.nativeStore) {
    throw new Error("Native subscription restore is unavailable");
  }
  await requireNativePurchaseEligibility(input.checkNativePurchaseEligibility);
  await input.purchases.moveNativeSubscription({
    claim: input.claimNativeSubscription,
    organizationId: input.scope.organizationId,
    userId: input.userId,
  });
}

/** Owns confirmation and the verified native restore/claim sequence. */
export function useNativeSubscriptionMove(
  input: UseNativeSubscriptionMoveInput,
) {
  const {
    checkNativePurchaseEligibility,
    claimNativeSubscription,
    currentScope,
    nativePurchaseAllowed,
    purchases,
    refresh,
    scopeRef,
    updateActionState,
    userId,
  } = input;
  const { logError } = useLog();
  const [openScope, setOpenScope] = useState<BillingActionScope | null>(null);
  const open =
    nativePurchaseAllowed &&
    openScope !== null &&
    scopeMatches(openScope, currentScope);
  const request = useCallback(() => {
    if (nativePurchaseAllowed) setOpenScope(currentScope);
  }, [currentScope, nativePurchaseAllowed]);
  const dismiss = useCallback(() => setOpenScope(null), []);

  useEffect(() => {
    if (!nativePurchaseAllowed) dismiss();
  }, [dismiss, nativePurchaseAllowed]);

  const confirm = useCallback(() => {
    const scope = currentScope;
    if (!nativePurchaseAllowed || !scopeMatches(scopeRef.current, scope)) {
      dismiss();
      return;
    }
    updateActionState(scope, (current) => ({
      ...current,
      actionError: null,
      busy: "restore",
    }));
    void (async () => {
      try {
        await restoreClaimAndBindNativeSubscription({
          checkNativePurchaseEligibility,
          claimNativeSubscription,
          purchases,
          scope,
          userId,
        });
        if (scopeMatches(scopeRef.current, scope)) await refresh();
      } catch (error) {
        logError(formatBillingPurchaseFailure(error, false));
        updateActionState(scope, (current) => ({
          ...current,
          actionError: nativeSubscriptionClaimErrorLabel(error),
        }));
      } finally {
        if (scopeMatches(scopeRef.current, scope)) dismiss();
        updateActionState(scope, (current) => ({
          ...current,
          busy: null,
        }));
      }
    })();
  }, [
    checkNativePurchaseEligibility,
    claimNativeSubscription,
    currentScope,
    dismiss,
    logError,
    nativePurchaseAllowed,
    purchases,
    refresh,
    scopeRef,
    updateActionState,
    userId,
  ]);

  return { confirm, dismiss, open, request };
}
