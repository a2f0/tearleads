import { useEffect } from "react";
import type {
  BillingActionScope,
  BillingActionState,
  UpdateActionState,
} from "../billing/billingActionScope";

/** Clears post-purchase polling once the target tier is pending or effective. */
export function useBillingUpdateSettlement(input: {
  readonly actionState: BillingActionState;
  readonly actionStateMatches: boolean;
  readonly billingIsActive: boolean;
  readonly billingPendingSeatCount: number | null;
  readonly billingSeatCount: number | null;
  readonly currentScope: BillingActionScope;
  readonly updateActionState: UpdateActionState;
}): boolean {
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
  const settled =
    actionStateMatches &&
    actionState.activationPending &&
    billingIsActive &&
    (target === null ||
      target === billingSeatCount ||
      target === billingPendingSeatCount);
  useEffect(() => {
    if (!settled) return;
    updateActionState(currentScope, (current) => ({
      ...current,
      activationPending: false,
      activationTargetSeatCount: null,
    }));
  }, [currentScope, settled, updateActionState]);
  return settled;
}
