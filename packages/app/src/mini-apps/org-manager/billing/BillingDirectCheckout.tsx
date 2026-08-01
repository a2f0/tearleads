import { useCallback, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppSection,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingPurchaseOption } from "./BillingView";
import { formatPrice } from "./billingFormatters";
import type { DirectCheckoutState } from "./useDirectCheckout";
import "./BillingCheckout.css";

/**
 * The in-app card checkout (issue #1654). Unlike the provider-hosted flow,
 * every control here is ours: the price row, the Pay button, and the Cancel
 * affordance are app components, and the payment fields mount into the host
 * div styled from the app's own theme tokens.
 */

/**
 * The off-site alternative to the inline form: mints a hosted Stripe Checkout
 * session and opens it in a NEW tab, so the buyer keeps this billing panel open
 * behind it. The session's success/cancel URLs return to this page.
 *
 * The tab is opened SYNCHRONOUSLY on the click — before the `await` — because a
 * `window.open` issued after an await is treated as programmatic and blocked by
 * pop-up blockers. The blank tab holds the user gesture and is pointed at the
 * minted URL once it resolves; if the pop-up was blocked (no handle), the
 * current tab navigates instead so the buyer is never stranded.
 */
function useHostedCheckout(): {
  readonly open: () => void;
  readonly busy: boolean;
  readonly unavailable: boolean;
} {
  const tearleads = useTearleads();
  const [busy, setBusy] = useState(false);
  // A null/failed result would otherwise reset the link silently, leaving a
  // dead-feeling click — e.g. a co-admin whose org is already checking out, or
  // an unconfigured integration. Surface a brief notice instead.
  const [unavailable, setUnavailable] = useState(false);
  const open = useCallback(() => {
    if (busy) {
      return;
    }
    setBusy(true);
    setUnavailable(false);
    const tab = globalThis.open?.("about:blank", "_blank");
    void (async () => {
      try {
        const result =
          await tearleads.organizations.createStripeCheckoutSession(
            globalThis.location?.href ?? "",
          );
        if (result?.url) {
          if (tab) {
            // Sever the child's back-reference before it navigates
            // cross-origin, so the Stripe page cannot reach into this window
            // (reverse tabnabbing); the blank tab is still same-origin here.
            tab.opener = null;
            tab.location.href = result.url;
          } else {
            // The pop-up was blocked: fall back to same-tab navigation rather
            // than leaving the click dead.
            globalThis.location?.assign(result.url);
          }
          setBusy(false);
          return;
        }
        // Unconfigured, not eligible, or a checkout already in progress.
        tab?.close();
        setUnavailable(true);
        setBusy(false);
      } catch (error) {
        console.error("Failed to open the hosted Stripe checkout:", error);
        tab?.close();
        setUnavailable(true);
        setBusy(false);
      }
    })();
  }, [busy, tearleads]);
  return { open, busy, unavailable };
}

function HostedCheckoutLink({ disabled }: { readonly disabled: boolean }) {
  const hosted = useHostedCheckout();
  return (
    <>
      <MiniAppActions>
        <MiniAppButton disabled={disabled || hosted.busy} onClick={hosted.open}>
          {hosted.busy
            ? ORG_MANAGER_LABELS.billingPayOnStripeStarting
            : ORG_MANAGER_LABELS.billingPayOnStripe}
        </MiniAppButton>
      </MiniAppActions>
      {hosted.unavailable ? (
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.billingPayOnStripeUnavailable}
        </MiniAppStatus>
      ) : null}
    </>
  );
}

export function BillingDirectCheckout({
  checkout,
  disabled,
}: {
  readonly checkout: DirectCheckoutState;
  /** Another billing action is in flight; do not start a competing one. */
  readonly disabled: boolean;
}) {
  const { option, phase } = checkout;
  if (!checkout.available) {
    return null;
  }
  if (!option) {
    return checkout.error ? (
      <MiniAppSection>
        <MiniAppStatus tone="error">{checkout.error}</MiniAppStatus>
      </MiniAppSection>
    ) : null;
  }
  const collecting = phase.kind === "collecting";
  const confirming = phase.kind === "confirming";
  const starting = phase.kind === "starting";
  const idle = phase.kind === "idle";

  return (
    <MiniAppSection>
      {idle ? (
        <>
          <BillingPurchaseOption
            actionLabel={ORG_MANAGER_LABELS.billingSubscribe}
            disabled={disabled}
            name={option.productName}
            onSelect={checkout.begin}
            priceLabel={formatPrice(
              option.unitAmount,
              option.currency,
              option.interval,
              option.intervalCount,
            )}
          />
          {/* The hosted-page escape hatch for buyers who prefer not to type
              their card into our inline form. */}
          <HostedCheckoutLink disabled={disabled} />
        </>
      ) : null}

      {starting ? (
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.billingCheckoutStarting}
        </MiniAppStatus>
      ) : null}

      {/*
        Always mounted while the flow is live so the element has a stable host
        to attach to; the payment fields render inside it.
      */}
      <div
        className="org-manager-direct-checkout"
        ref={checkout.hostRef}
        // Hidden rather than unmounted between attempts: unmounting would
        // destroy the node the provider element is attached to. Visible from
        // `starting` on, because that is exactly when the element mounts and
        // providers size their iframe off the host — mounting into a
        // display:none node yields a collapsed or unsized form.
        hidden={idle}
      />

      {collecting || confirming ? (
        <MiniAppActions>
          <MiniAppButton disabled={confirming} onClick={checkout.cancel}>
            {ORG_MANAGER_LABELS.billingCancelCheckout}
          </MiniAppButton>
          <MiniAppButton
            disabled={confirming || disabled}
            onClick={checkout.confirm}
          >
            {confirming
              ? ORG_MANAGER_LABELS.billingCheckoutPaying
              : ORG_MANAGER_LABELS.billingCheckoutPay}
          </MiniAppButton>
        </MiniAppActions>
      ) : null}

      {checkout.error ? (
        <MiniAppStatus tone="error">{checkout.error}</MiniAppStatus>
      ) : null}
    </MiniAppSection>
  );
}
