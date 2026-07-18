import type {
  PurchasesCapability,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import {
  type Dispatch,
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
  ACTIVATION_POLL_DELAYS_MS,
  useActivationBillingPoll,
} from "../billing/useActivationBillingPoll";
import { ORG_MANAGER_LABELS } from "../labels";

interface BillingActions {
  readonly purchaseAvailable: boolean;
  readonly canSubscribe: boolean;
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
  readonly busy: BillingBusyAction | null;
  readonly actionError: string | null;
  readonly activationPending: boolean;
  readonly startTrial: () => void;
  readonly subscribe: (option: SyncSubscriptionOption) => void;
  readonly restore: () => void;
}

interface BillingActionScope {
  readonly organizationId: string;
  readonly generation: number;
  readonly userId: string | null;
}

interface BillingActionState extends BillingActionScope {
  readonly busy: BillingBusyAction | null;
  readonly actionError: string | null;
  readonly activationPending: boolean;
}

interface BillingOptionsState extends BillingActionScope {
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
}

function scopeMatches(
  left: BillingActionScope,
  right: BillingActionScope,
): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.userId === right.userId &&
    left.generation === right.generation
  );
}

function emptyActionState(scope: BillingActionScope): BillingActionState {
  return {
    ...scope,
    busy: null,
    actionError: null,
    activationPending: false,
  };
}

function emptyOptionsState(scope: BillingActionScope): BillingOptionsState {
  return { ...scope, options: [] };
}

interface BillingScopeRef {
  current: BillingActionScope;
}

type UpdateActionState = (
  scope: BillingActionScope,
  update: (current: BillingActionState) => BillingActionState,
) => void;

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

function useSubscribeAction({
  canSubscribe,
  currentScope,
  purchases,
  refresh,
  scopeRef,
  updateActionState,
  userId,
}: {
  canSubscribe: boolean;
  currentScope: BillingActionScope;
  purchases: PurchasesCapability;
  refresh: () => Promise<void>;
  scopeRef: BillingScopeRef;
  updateActionState: UpdateActionState;
  userId: string | null;
}): (option: SyncSubscriptionOption) => void {
  return useCallback(
    (option) => {
      const scope = currentScope;
      if (!scopeMatches(scopeRef.current, scope) || !canSubscribe || !userId) {
        return;
      }
      updateActionState(scope, (current) => ({
        ...current,
        busy: `subscribe:${option.packageId}`,
        actionError: null,
      }));
      void purchaseForOrganization({
        option,
        purchases,
        refresh,
        scope,
        scopeRef,
        updateActionState,
        userId,
      });
    },
    [
      canSubscribe,
      currentScope,
      purchases,
      refresh,
      scopeRef,
      updateActionState,
      userId,
    ],
  );
}

async function purchaseForOrganization({
  option,
  purchases,
  refresh,
  scope,
  scopeRef,
  updateActionState,
  userId,
}: {
  option: SyncSubscriptionOption;
  purchases: PurchasesCapability;
  refresh: () => Promise<void>;
  scope: BillingActionScope;
  scopeRef: BillingScopeRef;
  updateActionState: UpdateActionState;
  userId: string;
}): Promise<void> {
  try {
    await purchases.identify({ userId });
    if (!scopeMatches(scopeRef.current, scope)) {
      return;
    }
    const result = await purchases.purchaseSync({
      organizationId: scope.organizationId,
      packageId: option.packageId,
    });
    if (!scopeMatches(scopeRef.current, scope)) {
      return;
    }
    if (!result.syncEntitlementActive) {
      updateActionState(scope, (current) => ({
        ...current,
        actionError: ORG_MANAGER_LABELS.failedSubscribe,
      }));
      return;
    }
    updateActionState(scope, (current) => ({
      ...current,
      activationPending: true,
    }));
    await refresh();
  } catch (error) {
    // Previously swallowed silently, which made a rejected purchase
    // indistinguishable from a no-op. Log the real PurchasesError (e.g. a
    // ConfigurationError from a key/offering mismatch, or a cancellation) so it
    // is diagnosable, while still surfacing the generic label to the user.
    console.error("Failed to complete the organization sync purchase:", error);
    updateActionState(scope, (current) => ({
      ...current,
      actionError: ORG_MANAGER_LABELS.failedSubscribe,
    }));
  } finally {
    updateActionState(scope, (current) => ({ ...current, busy: null }));
  }
}

function useRestoreAction(
  currentScope: BillingActionScope,
  purchases: PurchasesCapability,
  refresh: () => Promise<void>,
  scopeRef: BillingScopeRef,
  updateActionState: UpdateActionState,
): () => void {
  return useCallback(() => {
    const scope = currentScope;
    if (!scopeMatches(scopeRef.current, scope)) {
      return;
    }
    updateActionState(scope, (current) => ({
      ...current,
      busy: "restore",
      actionError: null,
    }));
    void (async () => {
      try {
        await purchases.restore();
        if (scopeMatches(scopeRef.current, scope)) {
          await refresh();
        }
      } catch {
        updateActionState(scope, (current) => ({
          ...current,
          actionError: ORG_MANAGER_LABELS.failedRestorePurchases,
        }));
      } finally {
        updateActionState(scope, (current) => ({ ...current, busy: null }));
      }
    })();
  }, [currentScope, purchases, refresh, scopeRef, updateActionState]);
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
  billingCanSync: boolean,
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

  useEffect(() => {
    if (billingCanSync) {
      updateActionState(currentScope, (current) => ({
        ...current,
        activationPending: false,
      }));
    }
  }, [billingCanSync, currentScope, updateActionState]);

  return {
    actionState,
    currentScope,
    optionsState,
    scopeRef,
    setOptionsState,
    updateActionState,
  };
}

/**
 * Owns the billing panel's in-flight action state and orchestrates the platform
 * purchases capability (list options, identify + purchase, restore), refetching
 * billing afterwards. Trial start is delegated to the billing snapshot hook.
 */
export function useBillingActions({
  activationPollDelaysMs = ACTIVATION_POLL_DELAYS_MS,
  billingCanSync,
  isOrgAdmin,
  organizationId,
  refresh,
  startTrial: startTrialRequest,
  userId,
}: {
  /** Backoff schedule for post-purchase billing re-reads; injectable for tests. */
  activationPollDelaysMs?: readonly number[];
  billingCanSync: boolean;
  isOrgAdmin: boolean;
  organizationId: string;
  refresh: () => Promise<void>;
  startTrial: () => Promise<boolean>;
  userId: string | null;
}): BillingActions {
  const purchases = usePurchases();
  const canSubscribe = isOrgAdmin && purchases.isAvailable && userId !== null;
  const {
    actionState,
    currentScope,
    optionsState,
    scopeRef,
    setOptionsState,
    updateActionState,
  } = useBillingActionState(billingCanSync, organizationId, userId);
  useBillingOptions(
    canSubscribe,
    currentScope,
    purchases,
    scopeRef,
    setOptionsState,
    userId,
  );
  const startTrial = useStartTrialAction(
    currentScope,
    scopeRef,
    startTrialRequest,
    updateActionState,
  );
  const subscribe = useSubscribeAction({
    canSubscribe,
    currentScope,
    purchases,
    refresh,
    scopeRef,
    updateActionState,
    userId,
  });
  const restore = useRestoreAction(
    currentScope,
    purchases,
    refresh,
    scopeRef,
    updateActionState,
  );

  const scopeMatchesInputs =
    currentScope.organizationId === organizationId &&
    currentScope.userId === userId;
  const actionStateMatches =
    scopeMatchesInputs && scopeMatches(actionState, currentScope);

  useActivationBillingPoll(
    actionStateMatches && actionState.activationPending,
    billingCanSync,
    refresh,
    activationPollDelaysMs,
  );

  const options =
    scopeMatchesInputs && scopeMatches(optionsState, currentScope)
      ? optionsState.options
      : [];

  return {
    purchaseAvailable: purchases.isAvailable,
    canSubscribe,
    options,
    busy: actionStateMatches ? actionState.busy : null,
    actionError: actionStateMatches ? actionState.actionError : null,
    activationPending: actionStateMatches
      ? actionState.activationPending
      : false,
    startTrial,
    subscribe,
    restore,
  };
}
