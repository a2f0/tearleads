import { useCallback, useEffect } from "react";
import type {
  BillingActionScope,
  BillingActionState,
  UpdateActionState,
} from "../billing/billingActionScope";
import { ORG_MANAGER_LABELS } from "../labels";

/** Clears polling once an upgrade is effective or a downgrade is scheduled. */
export function useBillingUpdateSettlement(input: {
  readonly actionState: BillingActionState;
  readonly actionStateMatches: boolean;
  readonly billingIsActive: boolean;
  readonly billingPendingSeatCount: number | null;
  readonly billingSeatCount: number | null;
  readonly currentScope: BillingActionScope;
  readonly updateActionState: UpdateActionState;
}): { readonly expire: () => void; readonly settled: boolean } {
  const {
    actionState,
    actionStateMatches,
    billingIsActive,
    billingPendingSeatCount,
    billingSeatCount,
    currentScope,
    updateActionState,
  } = input;
  const target = actionState.activationTargetSeatCount;
  const scheduledDowngrade =
    target !== null &&
    billingSeatCount !== null &&
    target < billingSeatCount &&
    target === billingPendingSeatCount;
  const settled =
    actionStateMatches &&
    actionState.activationPending &&
    billingIsActive &&
    (target === null || target === billingSeatCount || scheduledDowngrade);
  const expire = useCallback(() => {
    updateActionState(currentScope, (current) => ({
      ...current,
      actionError: ORG_MANAGER_LABELS.billingActivationUnconfirmed,
      activationPending: false,
      activationTargetSeatCount: null,
    }));
  }, [currentScope, updateActionState]);
  useEffect(() => {
    if (!settled) return;
    updateActionState(currentScope, (current) => ({
      ...current,
      activationPending: false,
      activationTargetSeatCount: null,
    }));
  }, [currentScope, settled, updateActionState]);
  return { expire, settled };
}
