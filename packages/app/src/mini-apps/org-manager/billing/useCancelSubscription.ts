import { useCallback, useState } from "react";
import { useSymCrypt } from "../../../providers/sdk/SymCryptProvider";
import { ORG_MANAGER_LABELS } from "../labels";

/**
 * Cancels the org's sync subscription from inside the panel (issue #1654).
 *
 * Deliberately NOT Stripe's hosted billing portal: the whole point of the
 * in-app checkout is that billing never leaves the window, and cancelling
 * needs no card entry — it is one server call — so there is nothing an
 * off-site page would buy here.
 *
 * The cancellation takes effect at the END of the paid period, so the org
 * keeps the sync it already paid for and RevenueCat flips the entitlement
 * through the same webhook path a lapsed renewal takes. That means success
 * does NOT change `canSync`, which is why this refreshes the billing snapshot
 * rather than assuming any immediate state change.
 */

export type CancelPhase =
  | { readonly kind: "idle" }
  /** Confirming — a cancellation is not something to trigger on one click. */
  | { readonly kind: "confirming" }
  | { readonly kind: "cancelling" }
  /**
   * Scheduled; access continues until the period closes. `cancelAt` is the
   * Unix-seconds end when Stripe reports one (null for an already-cancelling
   * subscription).
   */
  | { readonly kind: "scheduled"; readonly cancelAt: number | null };

export interface CancelSubscriptionState {
  readonly phase: CancelPhase;
  readonly error: string | null;
  readonly ask: () => void;
  readonly dismiss: () => void;
  readonly confirm: () => void;
}

export function useCancelSubscription(input: {
  /** Re-reads billing so the panel reflects the scheduled end. */
  readonly refresh: () => Promise<void>;
}): CancelSubscriptionState {
  const symcrypt = useSymCrypt();
  const [phase, setPhase] = useState<CancelPhase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const { refresh } = input;

  const ask = useCallback(() => {
    setPhase({ kind: "confirming" });
    setError(null);
  }, []);

  const dismiss = useCallback(() => {
    setPhase({ kind: "idle" });
    setError(null);
  }, []);

  const confirm = useCallback(() => {
    setPhase({ kind: "cancelling" });
    setError(null);
    void (async () => {
      try {
        const result = await symcrypt.organizations.cancelStripeSubscription();
        if (!result) {
          // 404 / unconfigured: nothing to cancel for this org. Surfacing the
          // generic failure is right — the admin cannot act on the difference,
          // and silently returning to idle would look like the click was lost.
          setPhase({ kind: "confirming" });
          setError(ORG_MANAGER_LABELS.billingCancelFailed);
          return;
        }
        // Cancelled. Move to the terminal state BEFORE refreshing: the
        // cancellation has already succeeded, so a failing refresh (a read)
        // must not fall into the catch and report the cancel as failed.
        setPhase({ kind: "scheduled", cancelAt: result.cancelAt });
      } catch (cancelError) {
        console.error("Failed to cancel the subscription:", cancelError);
        // Stay on the confirm step so the button they pressed is still there.
        setPhase({ kind: "confirming" });
        setError(ORG_MANAGER_LABELS.billingCancelFailed);
        return;
      }
      // Access continues to period end, so the panel must re-read to reflect
      // the scheduled end; its failure is not the cancel's failure.
      try {
        await refresh();
      } catch (refreshError) {
        console.error("Failed to refresh after cancelling:", refreshError);
      }
    })();
  }, [refresh, symcrypt]);

  return { phase, error, ask, dismiss, confirm };
}
