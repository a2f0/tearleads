import {
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  type PurchasesCapability,
  type SessionCreateOrganizationResult,
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
  readonly activateRestoredOrganization: (
    organization: SessionCreateOrganizationResult,
  ) => Promise<void>;
  readonly checkNativePurchaseEligibility: CheckNativePurchaseEligibility;
  readonly claimNativeSubscription: (
    organizationId: string,
    store: NativeSubscriptionStore,
  ) => Promise<boolean>;
  readonly completeRestoreOrganization: (
    organizationId: string,
  ) => Promise<boolean>;
  readonly createRestoreOrganization: () => Promise<SessionCreateOrganizationResult | null>;
  readonly currentScope: BillingActionScope;
  readonly nativePurchaseAllowed: boolean;
  readonly purchases: PurchasesCapability;
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
    organizationId: string,
    store: NativeSubscriptionStore,
  ) => Promise<boolean>;
  readonly createRestoreOrganization: () => Promise<SessionCreateOrganizationResult | null>;
  readonly purchases: PurchasesCapability;
  readonly scope: BillingActionScope;
  readonly scopeRef: BillingScopeRef;
  readonly userId: string | null;
}): Promise<SessionCreateOrganizationResult> {
  if (!input.userId || !input.purchases.nativeStore) {
    throw new Error("Native subscription restore is unavailable");
  }
  await requireNativePurchaseEligibility(
    input.checkNativePurchaseEligibility,
    input.purchases.nativeStore,
  );
  const preparedOrganizations: SessionCreateOrganizationResult[] = [];
  const move = await input.purchases.moveNativeSubscription({
    claim: async (organizationId, store) => {
      if (!scopeMatches(input.scopeRef.current, input.scope)) return false;
      return input.claimNativeSubscription(organizationId, store);
    },
    prepareClaim: async () => {
      if (!scopeMatches(input.scopeRef.current, input.scope)) return null;
      const preparedOrganization = await input.createRestoreOrganization();
      if (
        !preparedOrganization ||
        !scopeMatches(input.scopeRef.current, input.scope)
      ) {
        return null;
      }
      preparedOrganizations.push(preparedOrganization);
      return preparedOrganization.organizationId;
    },
    userId: input.userId,
  });
  const preparedOrganization = preparedOrganizations[0];
  if (preparedOrganization?.organizationId !== move.organizationId) {
    throw new Error("Native subscription restore target was lost");
  }
  return preparedOrganization;
}

/** Owns confirmation and the verified native restore/claim sequence. */
export function useNativeSubscriptionMove(
  input: UseNativeSubscriptionMoveInput,
) {
  const {
    activateRestoredOrganization,
    checkNativePurchaseEligibility,
    claimNativeSubscription,
    completeRestoreOrganization,
    createRestoreOrganization,
    currentScope,
    nativePurchaseAllowed,
    purchases,
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
        const restoredOrganization =
          await restoreClaimAndBindNativeSubscription({
            checkNativePurchaseEligibility,
            claimNativeSubscription,
            createRestoreOrganization,
            purchases,
            scope,
            scopeRef,
            userId,
          });
        if (scopeMatches(scopeRef.current, scope)) {
          await activateRestoredOrganization(restoredOrganization);
          const completed = await completeRestoreOrganization(
            restoredOrganization.organizationId,
          );
          if (!completed) {
            throw new Error("Native subscription restore completion was lost");
          }
        }
      } catch (error) {
        logError(formatBillingPurchaseFailure(error, false));
        updateActionState(scope, (current) => ({
          ...current,
          actionError: nativeSubscriptionClaimErrorLabel(error),
        }));
      } finally {
        if (scopeMatches(scopeRef.current, scope)) dismiss();
        updateActionState(scope, (current) => ({ ...current, busy: null }));
      }
    })();
  }, [
    activateRestoredOrganization,
    checkNativePurchaseEligibility,
    claimNativeSubscription,
    completeRestoreOrganization,
    createRestoreOrganization,
    currentScope,
    dismiss,
    logError,
    nativePurchaseAllowed,
    purchases,
    scopeRef,
    updateActionState,
    userId,
  ]);

  return { confirm, dismiss, open, request };
}
