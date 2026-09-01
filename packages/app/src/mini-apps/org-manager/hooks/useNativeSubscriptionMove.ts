import {
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  type PurchasesCapability,
  type SessionCreateOrganizationResult,
} from "@tearleads/client-sdk";
import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
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

interface NativeMoveAttempt {
  readonly scope: BillingActionScope;
}

type NativeMoveAttemptRef = RefObject<NativeMoveAttempt | null>;

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
  readonly attemptRef: NativeMoveAttemptRef;
  readonly currentScope: BillingActionScope;
  readonly dismiss: () => void;
  readonly nativePurchaseAllowed: boolean;
  readonly updateActionState: UpdateActionState;
}): void {
  useEffect(() => {
    if (input.nativePurchaseAllowed) return;
    input.attemptRef.current = null;
    input.dismiss();
    input.updateActionState(input.currentScope, (current) =>
      current.busy === "restore" ? { ...current, busy: null } : current,
    );
  }, [
    input.attemptRef,
    input.currentScope,
    input.dismiss,
    input.nativePurchaseAllowed,
    input.updateActionState,
  ]);
}

function nativeMoveIsCurrent(input: {
  readonly attempt: NativeMoveAttempt;
  readonly attemptRef: NativeMoveAttemptRef;
  readonly nativePurchaseAllowedRef: RefObject<boolean>;
  readonly scope: BillingActionScope;
  readonly scopeRef: BillingScopeRef;
}): boolean {
  return (
    input.attemptRef.current === input.attempt &&
    input.nativePurchaseAllowedRef.current &&
    scopeMatches(input.scopeRef.current, input.scope)
  );
}

async function restoreClaimAndBindNativeSubscription(input: {
  readonly attempt: NativeMoveAttempt;
  readonly attemptRef: NativeMoveAttemptRef;
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
  if (!nativeMoveIsCurrent(input)) {
    return null;
  }
  const preparedOrganizations: SessionCreateOrganizationResult[] = [];
  const move = await input.purchases.moveNativeSubscription({
    claim: async (organizationId, store) => {
      if (!nativeMoveIsCurrent(input)) {
        return false;
      }
      const claimed = await input.claimNativeSubscription(
        organizationId,
        store,
      );
      return nativeMoveIsCurrent(input) && claimed;
    },
    prepareClaim: async () => {
      if (!nativeMoveIsCurrent(input)) {
        return null;
      }
      const preparedOrganization = await input.createRestoreOrganization();
      if (!preparedOrganization || !nativeMoveIsCurrent(input)) {
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
  readonly attempt: NativeMoveAttempt;
  readonly attemptRef: NativeMoveAttemptRef;
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
    if (nativeMoveIsCurrent(input)) {
      await input.activateRestoredOrganization(restoredOrganization);
      if (!nativeMoveIsCurrent(input)) return;
      const completed = await input.completeRestoreOrganization(
        restoredOrganization.organizationId,
      );
      if (!completed) {
        throw new Error("Native subscription restore completion was lost");
      }
    }
  } catch (error) {
    if (!nativeMoveIsCurrent(input)) return;
    input.logError(formatBillingPurchaseFailure(error, false));
    input.updateActionState(input.scope, (current) => ({
      ...current,
      actionError: nativeSubscriptionClaimErrorLabel(error),
    }));
  } finally {
    if (input.attemptRef.current === input.attempt) {
      input.attemptRef.current = null;
      if (scopeMatches(input.scopeRef.current, input.scope)) input.dismiss();
      input.updateActionState(input.scope, (current) => ({
        ...current,
        busy: null,
      }));
    }
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
  const attemptRef = useRef<NativeMoveAttempt | null>(null);
  const nativePurchaseAllowedRef = useAllowedRef(nativePurchaseAllowed);
  const { dismiss, open, request } = useNativeSubscriptionMoveDialog(
    currentScope,
    nativePurchaseAllowed,
  );

  useDismissDisallowedNativeMove({
    attemptRef,
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
    if (
      attemptRef.current &&
      scopeMatches(attemptRef.current.scope, currentScope)
    ) {
      return;
    }
    const attempt = { scope: currentScope };
    attemptRef.current = attempt;
    updateActionState(currentScope, (current) => ({
      ...current,
      actionError: null,
      busy: "restore",
    }));
    void runNativeSubscriptionMove({
      activateRestoredOrganization,
      attempt,
      attemptRef,
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
