import type { BillingBusyAction } from "./BillingView";

/**
 * Identity of one billing panel instance: which org and buyer it acts for, plus
 * a generation bumped on every switch so in-flight async work from a previous
 * scope can never commit into the current one. Shared by the billing action
 * hooks ({@link useBillingActions} and the subscribe flow it delegates to).
 */
export interface BillingActionScope {
  readonly organizationId: string;
  readonly generation: number;
  readonly userId: string | null;
}

export interface BillingActionState extends BillingActionScope {
  readonly busy: BillingBusyAction | null;
  readonly actionError: string | null;
  readonly activationPending: boolean;
  /** Paid or pending tier the server snapshot must reach after a purchase. */
  readonly activationTargetSeatCount: number | null;
  /**
   * True only while a purchase's checkout can still be cancelled — from flow
   * start until the purchase race settles. Distinct from `busy`, which also
   * spans the post-payment billing refresh, when there is nothing left to
   * cancel.
   */
  readonly checkoutActive: boolean;
}

export interface BillingScopeRef {
  current: BillingActionScope;
}

export type UpdateActionState = (
  scope: BillingActionScope,
  update: (current: BillingActionState) => BillingActionState,
) => void;

export function scopeMatches(
  left: BillingActionScope,
  right: BillingActionScope,
): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.userId === right.userId &&
    left.generation === right.generation
  );
}

export function emptyActionState(
  scope: BillingActionScope,
): BillingActionState {
  return {
    ...scope,
    busy: null,
    actionError: null,
    activationPending: false,
    activationTargetSeatCount: null,
    checkoutActive: false,
  };
}
