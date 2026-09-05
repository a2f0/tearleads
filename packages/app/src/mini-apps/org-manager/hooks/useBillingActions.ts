import type {
  PurchasesCapability,
  SessionCreateOrganizationResult,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePurchases } from "../../../providers/purchases/PurchasesProvider";
import type { BillingBusyAction } from "../billing/BillingView";
import {
  type BillingActionScope,
  type BillingActionState,
  type BillingScopeRef,
  emptyActionState,
  scopeMatches,
  type UpdateActionState,
} from "../billing/billingActionScope";
import {
  ACTIVATION_POLL_DELAYS_MS,
  useActivationBillingPoll,
} from "../billing/useActivationBillingPoll";
import { useSubscribeAction } from "../billing/useSubscribeAction";
import type { CheckNativePurchaseEligibility } from "./nativePurchaseEligibility";
import {
  type BillingOptionsState,
  billingOptionsErrorLabel,
  emptyOptionsState,
} from "./useBillingOptions";
import { useBillingUpdateSettlement } from "./useBillingUpdateSettlement";
import { useNativeSubscriptionMove } from "./useNativeSubscriptionMove";
import { useResolvedBillingOptions } from "./useResolvedBillingOptions";

export interface BillingActions {
  readonly purchaseAvailable: boolean;
  readonly canSubscribe: boolean;
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
  readonly busy: BillingBusyAction | null;
  readonly actionError: string | null;
  readonly actionErrorIsOptionsError: boolean;
  readonly optionsRetryAvailable: boolean;
  readonly activationPending: boolean;
  readonly subscriptionMoveOpen: boolean;
  readonly startTrial: () => void;
  readonly subscribe: (option: SyncSubscriptionOption) => void;
  readonly retryOptions: () => void;
  /** Starts the webhook-settlement poll after an embedded checkout succeeds. */
  readonly markActivationPending: () => void;
  readonly requestSubscriptionMove: () => void;
  readonly dismissSubscriptionMove: () => void;
  readonly confirmSubscriptionMove: () => void;
}

function useActionStateUpdater(
  scopeRef: BillingScopeRef,
  setActionState: Dispatch<SetStateAction<BillingActionState>>,
): UpdateActionState {
  return useCallback(
    (scope, update) => {
      if (!scopeMatches(scopeRef.current, scope)) {
        return;
      }
      setActionState((current) => {
        if (!scopeMatches(scopeRef.current, scope)) {
          return current;
        }
        return update(
          scopeMatches(current, scope) ? current : emptyActionState(scope),
        );
      });
    },
    [scopeRef, setActionState],
  );
}

function useStartTrialAction(
  currentScope: BillingActionScope,
  scopeRef: BillingScopeRef,
  startTrialRequest: () => Promise<boolean>,
  updateActionState: UpdateActionState,
): () => void {
  return useCallback(() => {
    const scope = currentScope;
    if (!scopeMatches(scopeRef.current, scope)) {
      return;
    }
    updateActionState(scope, (current) => ({
      ...current,
      busy: "trial",
      actionError: null,
    }));
    void startTrialRequest().finally(() => {
      updateActionState(scope, (current) => ({ ...current, busy: null }));
    });
  }, [currentScope, scopeRef, startTrialRequest, updateActionState]);
}

/**
 * Owns the cancel action for the purchase currently in flight. Lifecycle
 * cleanup — a scope switch, lost eligibility, or unmount — cancels eligibility,
 * identity, and native preparation work before the store sheet presents. The
 * flow retires the action when the sheet opens, because the app cannot
 * dismiss it; after that the cleanup finds nothing to cancel.
 */
function usePurchaseAbortOnScopeChange(
  organizationId: string,
  userId: string | null,
  canSubscribe: boolean,
): RefObject<(() => void) | null> {
  const cancelPurchaseRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    return () => {
      cancelPurchaseRef.current?.();
    };
  }, [organizationId, userId, canSubscribe]);
  return cancelPurchaseRef;
}

/**
 * The provider-hosted purchase actions (trial, subscribe, restore). Grouped so
 * the top-level hook reads as state → options → actions → poll → projection.
 */
function usePurchaseActions(input: {
  canSubscribe: boolean;
  checkNativePurchaseEligibility: CheckNativePurchaseEligibility;
  checkoutEligible: boolean;
  currentScope: BillingActionScope;
  organizationId: string;
  purchases: PurchasesCapability;
  refresh: () => Promise<void>;
  scopeRef: BillingScopeRef;
  startTrialRequest: () => Promise<boolean>;
  updateActionState: UpdateActionState;
  userId: string | null;
  onAlreadyOwned: () => void;
}) {
  const startTrial = useStartTrialAction(
    input.currentScope,
    input.scopeRef,
    input.startTrialRequest,
    input.updateActionState,
  );
  const cancelPurchaseRef = usePurchaseAbortOnScopeChange(
    input.organizationId,
    input.userId,
    input.checkoutEligible,
  );
  const subscribe = useSubscribeAction({
    canSubscribe: input.canSubscribe,
    cancelPurchaseRef,
    checkNativePurchaseEligibility: input.checkNativePurchaseEligibility,
    currentScope: input.currentScope,
    purchases: input.purchases,
    refresh: input.refresh,
    scopeRef: input.scopeRef,
    updateActionState: input.updateActionState,
    userId: input.userId,
    onAlreadyOwned: input.onAlreadyOwned,
  });
  const markActivationPending = useMarkActivationPending(
    input.currentScope,
    input.refresh,
    input.updateActionState,
  );
  return { markActivationPending, startTrial, subscribe };
}

/**
 * Marks the org as awaiting activation and kicks the shared backoff poll —
 * the hand-off point for a payment whose entitlement is granted
 * asynchronously by the provider webhook (issue #1654).
 */
function useMarkActivationPending(
  currentScope: BillingActionScope,
  refresh: () => Promise<void>,
  updateActionState: UpdateActionState,
): () => void {
  return useCallback(() => {
    updateActionState(currentScope, (current) => ({
      ...current,
      activationPending: true,
      activationTargetSeatCount: null,
      actionError: null,
    }));
    void refresh();
  }, [currentScope, refresh, updateActionState]);
}

interface BillingActionStateController {
  readonly actionState: BillingActionState;
  readonly currentScope: BillingActionScope;
  readonly optionsState: BillingOptionsState;
  readonly scopeRef: BillingScopeRef;
  readonly setOptionsState: Dispatch<SetStateAction<BillingOptionsState>>;
  readonly updateActionState: UpdateActionState;
}

function useBillingActionState(
  organizationId: string,
  userId: string | null,
): BillingActionStateController {
  const scopeRef = useRef<BillingActionScope>({
    organizationId,
    generation: 0,
    userId,
  });
  const currentScope = scopeRef.current;
  const [optionsState, setOptionsState] = useState<BillingOptionsState>(() =>
    emptyOptionsState(currentScope),
  );
  const [actionState, setActionState] = useState<BillingActionState>(() =>
    emptyActionState(currentScope),
  );
  const updateActionState = useActionStateUpdater(scopeRef, setActionState);

  useLayoutEffect(() => {
    let scope = scopeRef.current;
    if (scope.organizationId !== organizationId || scope.userId !== userId) {
      scope = {
        organizationId,
        generation: scope.generation + 1,
        userId,
      };
      scopeRef.current = scope;
    }
    setActionState((current) =>
      scopeMatches(current, scope) ? current : emptyActionState(scope),
    );
    setOptionsState((current) =>
      scopeMatches(current, scope) ? current : emptyOptionsState(scope),
    );
    return () => {
      if (scopeMatches(scopeRef.current, scope)) {
        scopeRef.current = { ...scope, generation: scope.generation + 1 };
      }
    };
  }, [organizationId, userId]);

  return {
    actionState,
    currentScope,
    optionsState,
    scopeRef,
    setOptionsState,
    updateActionState,
  };
}

interface UseBillingActionsInput {
  /** Backoff schedule for post-purchase billing re-reads; injectable for tests. */
  activationPollDelaysMs?: readonly number[];
  /** Stable backoff schedule for transient identity reads; injectable for tests. */
  optionsRetryDelaysMs?: readonly number[];
  billingIsActive: boolean;
  billingPendingSeatCount: number | null;
  billingSeatCount: number | null;
  checkNativePurchaseEligibility: CheckNativePurchaseEligibility;
  activateRestoredOrganization: (
    organization: SessionCreateOrganizationResult,
  ) => Promise<void>;
  claimNativeSubscription: (
    organizationId: string,
    store: NativeSubscriptionStore,
  ) => Promise<boolean>;
  completeRestoreOrganization: (organizationId: string) => Promise<boolean>;
  createRestoreOrganization: () => Promise<SessionCreateOrganizationResult | null>;
  isOrgAdmin: boolean;
  /** New native purchases are offered only for the buyer's personal organization. */
  nativePurchaseAllowed?: boolean;
  organizationId: string;
  refresh: () => Promise<void>;
  startTrial: () => Promise<boolean>;
  userId: string | null;
}

function projectBillingActions(input: {
  readonly actionState: BillingActionState;
  readonly actionStateMatches: boolean;
  readonly actions: ReturnType<typeof usePurchaseActions>;
  readonly canSubscribe: boolean;
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
  readonly optionsErrorKind: BillingOptionsState["errorKind"];
  readonly purchases: PurchasesCapability;
  readonly retryOptions: () => void;
  readonly subscriptionMove: ReturnType<typeof useNativeSubscriptionMove>;
}): BillingActions {
  const busy = input.actionStateMatches ? input.actionState.busy : null;
  const optionsError =
    busy === null ? billingOptionsErrorLabel(input.optionsErrorKind) : null;
  const scopedActionError = input.actionStateMatches
    ? input.actionState.actionError
    : null;
  return {
    purchaseAvailable: input.purchases.isAvailable,
    canSubscribe: input.canSubscribe,
    options: input.options,
    busy,
    actionError: scopedActionError ?? optionsError,
    actionErrorIsOptionsError:
      scopedActionError === null && optionsError !== null,
    optionsRetryAvailable: busy === null && input.optionsErrorKind !== null,
    activationPending:
      input.actionStateMatches && input.actionState.activationPending,
    subscriptionMoveOpen: input.subscriptionMove.open,
    startTrial: input.actions.startTrial,
    subscribe: input.actions.subscribe,
    retryOptions: input.retryOptions,
    markActivationPending: input.actions.markActivationPending,
    requestSubscriptionMove: input.subscriptionMove.request,
    dismissSubscriptionMove: input.subscriptionMove.dismiss,
    confirmSubscriptionMove: input.subscriptionMove.confirm,
  };
}

function useBillingActionSettlement(input: {
  readonly actionState: BillingActionState;
  readonly actionStateMatches: boolean;
  readonly activationPollDelaysMs: readonly number[];
  readonly billingIsActive: boolean;
  readonly billingPendingSeatCount: number | null;
  readonly billingSeatCount: number | null;
  readonly currentScope: BillingActionScope;
  readonly refresh: () => Promise<void>;
  readonly updateActionState: UpdateActionState;
}) {
  const settlement = useBillingUpdateSettlement(input);
  useActivationBillingPoll(
    input.actionStateMatches && input.actionState.activationPending,
    settlement.settled,
    input.refresh,
    input.activationPollDelaysMs,
    settlement.expire,
  );
}

/**
 * Owns the billing panel's in-flight action state and orchestrates the platform
 * purchases capability (list options, identify + purchase, restore), refetching
 * billing afterwards. Trial start is delegated to the billing snapshot hook.
 */
export function useBillingActions({
  activateRestoredOrganization,
  activationPollDelaysMs = ACTIVATION_POLL_DELAYS_MS,
  billingIsActive,
  billingPendingSeatCount,
  billingSeatCount,
  checkNativePurchaseEligibility,
  claimNativeSubscription,
  completeRestoreOrganization,
  createRestoreOrganization,
  isOrgAdmin,
  nativePurchaseAllowed = true,
  optionsRetryDelaysMs,
  organizationId,
  refresh,
  startTrial: startTrialRequest,
  userId,
}: UseBillingActionsInput): BillingActions {
  const purchases = usePurchases();
  const canSubscribe =
    isOrgAdmin &&
    nativePurchaseAllowed &&
    purchases.isAvailable &&
    userId !== null;
  const {
    actionState,
    currentScope,
    optionsState,
    scopeRef,
    setOptionsState,
    updateActionState,
  } = useBillingActionState(organizationId, userId);
  const subscriptionMove = useNativeSubscriptionMove({
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
  });
  const {
    actionStateMatches,
    optionsErrorKind,
    optionsMatch,
    purchaseCanSubscribe,
    retryOptions,
  } = useResolvedBillingOptions({
    actionState,
    canSubscribe,
    currentScope,
    optionsRetryDelaysMs,
    optionsState,
    organizationId,
    purchases,
    scopeRef,
    setOptionsState,
    userId,
  });
  const actions = usePurchaseActions({
    canSubscribe: purchaseCanSubscribe,
    checkNativePurchaseEligibility,
    checkoutEligible: canSubscribe,
    currentScope,
    organizationId,
    purchases,
    refresh,
    scopeRef,
    startTrialRequest,
    updateActionState,
    userId,
    onAlreadyOwned: subscriptionMove.request,
  });
  useBillingActionSettlement({
    actionState,
    actionStateMatches,
    activationPollDelaysMs,
    billingIsActive,
    billingPendingSeatCount,
    billingSeatCount,
    currentScope,
    refresh,
    updateActionState,
  });
  return projectBillingActions({
    actionState,
    actionStateMatches,
    actions,
    canSubscribe: purchaseCanSubscribe,
    options: optionsMatch ? optionsState.options : [],
    optionsErrorKind,
    purchases,
    retryOptions,
    subscriptionMove,
  });
}
