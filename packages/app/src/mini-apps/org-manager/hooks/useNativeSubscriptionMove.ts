import {
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  type PurchasesCapability,
  type SessionCreateOrganizationResult,
} from "@symcrypt/client-sdk";
import type { NativeSubscriptionStore } from "@symcrypt/validators/billing";
import { type RefObject, useCallback, useRef, useState } from "react";
import { useLog } from "../../../providers/logging/LogProvider";
import { formatBillingPurchaseFailure } from "../../../utils/billingPurchaseTrace";
import {
  type BillingActionScope,
  type BillingScopeRef,
  scopeMatches,
  type UpdateActionState,
} from "../billing/billingActionScope";
import { ORG_MANAGER_LABELS } from "../labels";

interface UseNativeSubscriptionMoveInput {
  readonly activateRestoredOrganization: (
    organization: SessionCreateOrganizationResult,
  ) => void;
  readonly claimNativeSubscription: (
    organizationId: string,
    store: NativeSubscriptionStore,
  ) => Promise<boolean>;
  readonly createRestoreOrganization: () => Promise<SessionCreateOrganizationResult | null>;
  readonly currentScope: BillingActionScope;
  readonly purchases: PurchasesCapability;
  readonly scopeRef: BillingScopeRef;
  readonly updateActionState: UpdateActionState;
  readonly userId: string | null;
}

function nativeSubscriptionClaimErrorLabel(error: unknown): string {
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
  readonly claimNativeSubscription: (
    organizationId: string,
    store: NativeSubscriptionStore,
  ) => Promise<boolean>;
  readonly createRestoreOrganization: () => Promise<SessionCreateOrganizationResult | null>;
  readonly pendingOrganizationRef: RefObject<{
    readonly organization: SessionCreateOrganizationResult;
    readonly scope: BillingActionScope;
  } | null>;
  readonly purchases: PurchasesCapability;
  readonly scope: BillingActionScope;
  readonly scopeRef: BillingScopeRef;
  readonly userId: string | null;
}): Promise<SessionCreateOrganizationResult> {
  if (!input.userId || !input.purchases.nativeStore) {
    throw new Error("Native subscription restore is unavailable");
  }
  const move = await input.purchases.moveNativeSubscription({
    claim: async (organizationId, store) => {
      if (!scopeMatches(input.scopeRef.current, input.scope)) return false;
      return input.claimNativeSubscription(organizationId, store);
    },
    prepareClaim: async () => {
      if (!scopeMatches(input.scopeRef.current, input.scope)) return null;
      let pending = input.pendingOrganizationRef.current;
      if (!pending || !scopeMatches(pending.scope, input.scope)) {
        const organization = await input.createRestoreOrganization();
        if (
          !organization ||
          !scopeMatches(input.scopeRef.current, input.scope)
        ) {
          return null;
        }
        pending = { organization, scope: input.scope };
        input.pendingOrganizationRef.current = pending;
      }
      return pending.organization.organizationId;
    },
    userId: input.userId,
  });
  const pending = input.pendingOrganizationRef.current;
  if (
    !pending ||
    !scopeMatches(pending.scope, input.scope) ||
    pending.organization.organizationId !== move.organizationId
  ) {
    throw new Error("Native subscription restore target was lost");
  }
  return pending.organization;
}

/** Owns confirmation and the verified native restore/claim sequence. */
export function useNativeSubscriptionMove(
  input: UseNativeSubscriptionMoveInput,
) {
  const {
    activateRestoredOrganization,
    claimNativeSubscription,
    createRestoreOrganization,
    currentScope,
    purchases,
    scopeRef,
    updateActionState,
    userId,
  } = input;
  const { logError } = useLog();
  const [openScope, setOpenScope] = useState<BillingActionScope | null>(null);
  const pendingOrganizationRef = useRef<{
    readonly organization: SessionCreateOrganizationResult;
    readonly scope: BillingActionScope;
  } | null>(null);
  const open = openScope !== null && scopeMatches(openScope, currentScope);
  const request = useCallback(() => setOpenScope(currentScope), [currentScope]);
  const dismiss = useCallback(() => setOpenScope(null), []);

  const confirm = useCallback(() => {
    const scope = currentScope;
    if (!scopeMatches(scopeRef.current, scope)) return;
    updateActionState(scope, (current) => ({
      ...current,
      actionError: null,
      busy: "restore",
    }));
    void (async () => {
      try {
        const restoredOrganization =
          await restoreClaimAndBindNativeSubscription({
            claimNativeSubscription,
            createRestoreOrganization,
            pendingOrganizationRef,
            purchases,
            scope,
            scopeRef,
            userId,
          });
        if (scopeMatches(scopeRef.current, scope)) {
          pendingOrganizationRef.current = null;
          activateRestoredOrganization(restoredOrganization);
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
    claimNativeSubscription,
    createRestoreOrganization,
    currentScope,
    dismiss,
    logError,
    purchases,
    scopeRef,
    updateActionState,
    userId,
  ]);

  return { confirm, dismiss, open, request };
}
