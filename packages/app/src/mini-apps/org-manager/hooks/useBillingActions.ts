import type {
  PurchasesCapability,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
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
import {
  useNativeSubscriptionMove,
  useSubscribeAction,
} from "../billing/useSubscribeAction";
import { useBillingUpdateSettlement } from "./useBillingUpdateSettlement";

export interface BillingActions {
  readonly purchaseAvailable: boolean;
  readonly canSubscribe: boolean;
  /** Whether this platform embeds a cancellable checkout in the panel. */
  readonly embeddedCheckout: boolean;
  /** True while an embedded checkout can still be cancelled (not the refresh tail). */
  readonly checkoutActive: boolean;
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
  readonly busy: BillingBusyAction | null;
  readonly actionError: string | null;
  readonly activationPending: boolean;
  readonly subscriptionMoveOpen: boolean;
  readonly startTrial: () => void;
  readonly subscribe: (option: SyncSubscriptionOption) => void;
  readonly cancelCheckout: () => void;
  /** Starts the webhook-settlement poll after an embedded checkout succeeds. */
  readonly markActivationPending: () => void;
  readonly requestSubscriptionMove: () => void;
  readonly dismissSubscriptionMove: () => void;
  readonly confirmSubscriptionMove: () => void;
}

interface BillingOptionsState extends BillingActionScope {
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
}

function emptyOptionsState(scope: BillingActionScope): BillingOptionsState {
  return { ...scope, options: [] };
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

function useBillingOptions(
  canSubscribe: boolean,
  currentScope: BillingActionScope,
  purchases: PurchasesCapability,
  scopeRef: BillingScopeRef,
  setOptionsState: Dispatch<SetStateAction<BillingOptionsState>>,
  userId: string | null,
): void {
  useEffect(() => {
    const scope = currentScope;
    if (!scopeMatches(scopeRef.current, scope)) {
      return;
    }
    setOptionsState(emptyOptionsState(scope));
    if (!canSubscribe || userId === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await purchases.identify({ userId });
        if (cancelled || !scopeMatches(scopeRef.current, scope)) {
          return;
        }
        const next = await purchases.listSyncOptions();
        if (!cancelled && scopeMatches(scopeRef.current, scope)) {
          setOptionsState({ ...scope, options: next });
        }
      } catch {
        if (!cancelled && scopeMatches(scopeRef.current, scope)) {
          setOptionsState(emptyOptionsState(scope));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    canSubscribe,
    currentScope,
    purchases,
    scopeRef,
    setOptionsState,
    userId,
  ]);
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
 * Owns the cancel action for the purchase currently in flight. Also ties the
 * embedded checkout to its host's lifetime: when the buyer scope changes,
 * purchase eligibility is lost (e.g. the buyer's admin role is revoked
 * mid-purchase, which unmounts the admin actions and the host with them), or
 * the panel unmounts, the in-flight purchase is cancelled so an orphaned
 * provider flow is not left running with no reachable UI. Embedded web only:
 * a native purchase runs in a store sheet the app cannot cancel, so settling
 * it as cancelled here would just desync the panel from a still-active sheet.
 */
function useCheckoutCancellation(
  embeddedCheckout: boolean,
  organizationId: string,
  userId: string | null,
  canSubscribe: boolean,
): {
  cancelPurchaseRef: RefObject<(() => void) | null>;
  cancelCheckout: () => void;
} {
  const cancelPurchaseRef = useRef<(() => void) | null>(null);
  const cancelCheckout = useCallback(() => {
    cancelPurchaseRef.current?.();
  }, []);
  useEffect(() => {
    if (!embeddedCheckout) {
      return;
    }
    return () => {
      cancelPurchaseRef.current?.();
    };
  }, [embeddedCheckout, organizationId, userId, canSubscribe]);
  return { cancelPurchaseRef, cancelCheckout };
}

/**
 * The provider-hosted purchase actions (trial, subscribe, restore) plus the
 * embedded-checkout cancellation they share. Grouped so the top-level hook
 * reads as state → options → actions → poll → projection.
 */
function usePurchaseActions(input: {
  canSubscribe: boolean;
  checkoutHostRef?: RefObject<HTMLElement | null> | undefined;
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
  const { cancelCheckout, cancelPurchaseRef } = useCheckoutCancellation(
    input.purchases.supportsEmbeddedCheckout === true,
    input.organizationId,
    input.userId,
    input.canSubscribe,
  );
  const subscribe = useSubscribeAction({
    canSubscribe: input.canSubscribe,
    cancelPurchaseRef,
    checkoutHostRef: input.checkoutHostRef,
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
  return {
    cancelCheckout,
    markActivationPending,
    startTrial,
    subscribe,
  };
}

/**
 * Whether the live scope still matches the caller's inputs, and whether the
 * held action state belongs to it. Both gate every value the hook returns, so
 * a stale scope reports neutral rather than another org's state.
 */
function resolveScopeMatches(input: {
  actionState: BillingActionState;
  currentScope: BillingActionScope;
  organizationId: string;
  userId: string | null;
}): { scopeMatchesInputs: boolean; actionStateMatches: boolean } {
  const scopeMatchesInputs =
    input.currentScope.organizationId === input.organizationId &&
    input.currentScope.userId === input.userId;
  return {
    scopeMatchesInputs,
    actionStateMatches:
      scopeMatchesInputs && scopeMatches(input.actionState, input.currentScope),
  };
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
  billingIsActive: boolean;
  billingPendingSeatCount: number | null;
  billingSeatCount: number | null;
  claimNativeSubscription: (store: NativeSubscriptionStore) => Promise<boolean>;
  /** Checkout embed host, read at purchase time; absent = full-page overlay. */
  checkoutHostRef?: RefObject<HTMLElement | null>;
  isOrgAdmin: boolean;
  /** Native store purchases may fund only the buyer's personal organization. */
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
  readonly purchases: PurchasesCapability;
  readonly subscriptionMove: ReturnType<typeof useNativeSubscriptionMove>;
}): BillingActions {
  return {
    purchaseAvailable: input.purchases.isAvailable,
    canSubscribe: input.canSubscribe,
    embeddedCheckout: input.purchases.supportsEmbeddedCheckout === true,
    checkoutActive: input.actionStateMatches
      ? input.actionState.checkoutActive
      : false,
    options: input.options,
    busy: input.actionStateMatches ? input.actionState.busy : null,
    actionError: input.actionStateMatches
      ? input.actionState.actionError
      : null,
    activationPending:
      input.actionStateMatches && input.actionState.activationPending,
    subscriptionMoveOpen: input.subscriptionMove.open,
    startTrial: input.actions.startTrial,
    subscribe: input.actions.subscribe,
    cancelCheckout: input.actions.cancelCheckout,
    markActivationPending: input.actions.markActivationPending,
    requestSubscriptionMove: input.subscriptionMove.request,
    dismissSubscriptionMove: input.subscriptionMove.dismiss,
    confirmSubscriptionMove: input.subscriptionMove.confirm,
  };
}

/**
 * Owns the billing panel's in-flight action state and orchestrates the platform
 * purchases capability (list options, identify + purchase, restore), refetching
 * billing afterwards. Trial start is delegated to the billing snapshot hook.
 */
export function useBillingActions({
  activationPollDelaysMs = ACTIVATION_POLL_DELAYS_MS,
  billingIsActive,
  billingPendingSeatCount,
  billingSeatCount,
  claimNativeSubscription,
  checkoutHostRef,
  isOrgAdmin,
  nativePurchaseAllowed = true,
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
    claimNativeSubscription,
    currentScope,
    purchases,
    refresh,
    scopeRef,
    updateActionState,
    userId,
  });
  useBillingOptions(
    canSubscribe,
    currentScope,
    purchases,
    scopeRef,
    setOptionsState,
    userId,
  );
  const actions = usePurchaseActions({
    canSubscribe,
    checkoutHostRef,
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

  const { scopeMatchesInputs, actionStateMatches } = resolveScopeMatches({
    actionState,
    currentScope,
    organizationId,
    userId,
  });
  const activationSettlement = useBillingUpdateSettlement({
    actionState,
    actionStateMatches,
    billingIsActive,
    billingPendingSeatCount,
    billingSeatCount,
    currentScope,
    updateActionState,
  });
  useActivationBillingPoll(
    actionStateMatches && actionState.activationPending,
    activationSettlement.settled,
    refresh,
    activationPollDelaysMs,
    activationSettlement.expire,
  );
  const options =
    scopeMatchesInputs && scopeMatches(optionsState, currentScope)
      ? optionsState.options
      : [];

  return projectBillingActions({
    actionState,
    actionStateMatches,
    actions,
    canSubscribe,
    options,
    purchases,
    subscriptionMove,
  });
}
