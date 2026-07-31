import {
  MiniAppActions,
  MiniAppButton,
  MiniAppSection,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { ORG_MANAGER_LABELS } from "../labels";
import type { CancelSubscriptionState } from "./useCancelSubscription";

/**
 * In-panel cancellation for a subscription bought through the card checkout
 * (issue #1654). Every control is ours — the same reason the checkout form is
 * inline rather than an off-site Stripe page.
 *
 * Two steps by design: cancelling ends a paid service, so it should not be one
 * misplaced click away.
 */
export function BillingCancelSubscription({
  cancel,
  disabled,
}: {
  readonly cancel: CancelSubscriptionState;
  /** Another billing action is in flight. */
  readonly disabled: boolean;
}) {
  const { phase } = cancel;
  const cancelling = phase.kind === "cancelling";

  if (phase.kind === "scheduled") {
    return (
      <MiniAppSection>
        <MiniAppStatus className="org-manager-hint">
          {phase.cancelAt !== null
            ? ORG_MANAGER_LABELS.billingCancelScheduledOn(
                // Seconds → a plain local date; the exact time is noise here.
                new Date(phase.cancelAt * 1000).toLocaleDateString(),
              )
            : ORG_MANAGER_LABELS.billingCancelScheduled}
        </MiniAppStatus>
      </MiniAppSection>
    );
  }

  if (phase.kind === "idle") {
    return (
      <MiniAppSection>
        <MiniAppActions>
          <MiniAppButton disabled={disabled} onClick={cancel.ask}>
            {ORG_MANAGER_LABELS.billingCancelSubscription}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppSection>
    );
  }

  return (
    <MiniAppSection>
      {/* Say what cancelling actually does before asking them to confirm it:
          access continues to the end of the period they already paid for. */}
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.billingCancelSubscriptionHint}
      </MiniAppStatus>
      <MiniAppActions>
        <MiniAppButton
          disabled={disabled || cancelling}
          onClick={cancel.confirm}
        >
          {cancelling
            ? ORG_MANAGER_LABELS.billingCancelling
            : ORG_MANAGER_LABELS.billingCancelSubscriptionConfirm}
        </MiniAppButton>
        <MiniAppButton disabled={cancelling} onClick={cancel.dismiss}>
          {ORG_MANAGER_LABELS.billingCancelSubscriptionKeep}
        </MiniAppButton>
      </MiniAppActions>
      {cancel.error ? (
        <MiniAppStatus tone="error">{cancel.error}</MiniAppStatus>
      ) : null}
    </MiniAppSection>
  );
}
