import {
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  type PurchasesCapability,
  type SessionCreateOrganizationResult,
} from "@symcrypt/client-sdk";
import type { NativeSubscriptionStore } from "@symcrypt/validators/billing";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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

function useAllowedRef(nativePurchaseAllowed: boolean): RefObject<boolean> {
  const ref = useRef(nativePurchaseAllowed);
  useLayoutEffect(() => {
    ref.current = nativePurchaseAllowed;
  }, [nativePurchaseAllowed]);
  return ref;
}

function useNativeSubscriptionMoveDialog(
  currentScope: BillingActionScope,
  nativePurchaseAllowed: boolean,
) {
  const [openScope, setOpenScope] = useState<BillingActionScope | null>(null);
  const open =
    nativePurchaseAllowed &&
    openScope !== null &&
    scopeMatches(openScope, currentScope);
  const request = useCallback(() => {
    if (nativePurchaseAllowed) setOpenScope(currentScope);
  }, [currentScope, nativePurchaseAllowed]);
  const dismiss = useCallback(() => setOpenScope(null), []);
  return { dismiss, open, request };
}

function useDismissDisallowedNativeMove(input: {
  readonly currentScope: BillingActionScope;
  readonly dismiss: () => void;
  readonly nativePurchaseAllowed: boolean;
  readonly updateActionState: UpdateActionState;
}): void {
  useEffect(() => {
    if (input.nativePurchaseAllowed) return;
    input.dismiss();
    input.updateActionState(input.currentScope, (current) =>
      current.busy === "restore" ? { ...current, busy: null } : current,
    );
  }, [
    input.currentScope,
    input.dismiss,
    input.nativePurchaseAllowed,
    input.updateActionState,
  ]);
}

async function restoreClaimAndBindNativeSubscription(input: {
  readonly checkNativePurchaseEligibility: CheckNativePurchaseEligibility;
  readonly claimNativeSubscription: (
    organizationId: string,
    store: NativeSubscriptionStore,
  ) => Promise<boolean>;
  readonly createRestoreOrganization: () => Promise<SessionCreateOrganizationResult | null>;
  readonly nativePurchaseAllowedRef: RefObject<boolean>;
  readonly purchases: PurchasesCapability;
  readonly scope: BillingActionScope;
  readonly scopeRef: BillingScopeRef;
  readonly userId: string | null;
}): Promise<SessionCreateOrganizationResult | null> {
  if (!input.userId || !input.purchases.nativeStore) {
    throw new Error("Native subscription restore is unavailable");
  }
  await requireNativePurchaseEligibility(
    input.checkNativePurchaseEligibility,
    input.purchases.nativeStore,
  );
  if (
    !input.nativePurchaseAllowedRef.current ||
    !scopeMatches(input.scopeRef.current, input.scope)
  ) {
    return null;
  }
  const preparedOrganizations: SessionCreateOrganizationResult[] = [];
  const move = await input.purchases.moveNativeSubscription({
    claim: async (organizationId, store) => {
      if (
        !input.nativePurchaseAllowedRef.current ||
        !scopeMatches(input.scopeRef.current, input.scope)
      ) {
        return false;
      }
      return input.claimNativeSubscription(organizationId, store);
    },
    prepareClaim: async () => {
      if (
        !input.nativePurchaseAllowedRef.current ||
        !scopeMatches(input.scopeRef.current, input.scope)
      ) {
        return null;
      }
      const preparedOrganization = await input.createRestoreOrganization();
      if (
        !preparedOrganization ||
        !input.nativePurchaseAllowedRef.current ||
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

type NativeSubscriptionMoveExecution = Pick<
  UseNativeSubscriptionMoveInput,
  | "activateRestoredOrganization"
  | "checkNativePurchaseEligibility"
  | "claimNativeSubscription"
  | "completeRestoreOrganization"
  | "createRestoreOrganization"
  | "purchases"
  | "scopeRef"
  | "updateActionState"
  | "userId"
> & {
  readonly dismiss: () => void;
  readonly logError: (message: string) => void;
  readonly nativePurchaseAllowedRef: RefObject<boolean>;
  readonly scope: BillingActionScope;
};

async function runNativeSubscriptionMove(
  input: NativeSubscriptionMoveExecution,
): Promise<void> {
  try {
    const restoredOrganization =
      await restoreClaimAndBindNativeSubscription(input);
    if (!restoredOrganization) return;
    if (scopeMatches(input.scopeRef.current, input.scope)) {
      await input.activateRestoredOrganization(restoredOrganization);
      const completed = await input.completeRestoreOrganization(
        restoredOrganization.organizationId,
      );
      if (!completed) {
        throw new Error("Native subscription restore completion was lost");
      }
    }
  } catch (error) {
    input.logError(formatBillingPurchaseFailure(error, false));
    if (
      input.nativePurchaseAllowedRef.current &&
      scopeMatches(input.scopeRef.current, input.scope)
    ) {
      input.updateActionState(input.scope, (current) => ({
        ...current,
        actionError: nativeSubscriptionClaimErrorLabel(error),
      }));
    }
  } finally {
    if (scopeMatches(input.scopeRef.current, input.scope)) input.dismiss();
    input.updateActionState(input.scope, (current) => ({
      ...current,
      busy: null,
    }));
  }
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
  const nativePurchaseAllowedRef = useAllowedRef(nativePurchaseAllowed);
  const { dismiss, open, request } = useNativeSubscriptionMoveDialog(
    currentScope,
    nativePurchaseAllowed,
  );

  useDismissDisallowedNativeMove({
    currentScope,
    dismiss,
    nativePurchaseAllowed,
    updateActionState,
  });

  const confirm = useCallback(() => {
    if (
      !nativePurchaseAllowed ||
      !scopeMatches(scopeRef.current, currentScope)
    ) {
      dismiss();
      return;
    }
    updateActionState(currentScope, (current) => ({
      ...current,
      actionError: null,
      busy: "restore",
    }));
    void runNativeSubscriptionMove({
      activateRestoredOrganization,
      checkNativePurchaseEligibility,
      claimNativeSubscription,
      completeRestoreOrganization,
      createRestoreOrganization,
      dismiss,
      logError,
      nativePurchaseAllowedRef,
      purchases,
      scope: currentScope,
      scopeRef,
      updateActionState,
      userId,
    });
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
