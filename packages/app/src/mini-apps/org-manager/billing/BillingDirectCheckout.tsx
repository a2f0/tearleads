import { useEffect, useRef } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { useAppFeatureFlags } from "../../../providers/feature-flags/AppFeatureFlagsProvider";
import { formatPrice } from "../../shared/billingFormatters";
import { ORG_MANAGER_LABELS } from "../labels";
import { BillingPurchaseOption } from "./BillingPlanSwitcher";
import type { DirectCheckoutState } from "./useDirectCheckout";
import { useHostedCheckout } from "./useHostedCheckout";
import "./BillingCheckout.css";

/**
 * The in-app card checkout (issue #1654). Unlike the provider-hosted flow,
 * every control here is ours: the price row, the Pay button, and the Cancel
 * affordance are app components, and the payment fields mount into the host
 * div styled from the app's own theme tokens.
 */

function HostedCheckoutLink({
  disabled,
  organizationId,
}: {
  readonly disabled: boolean;
  readonly organizationId: string;
}) {
  const hosted = useHostedCheckout(organizationId);
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

/**
 * The checkout screen's header: the billing panel hides everything else once
 * Subscribe is clicked, so this names the screen and restates what is being
 * bought. Focus moves to the heading on arrival, as on any new screen.
 */
function CheckoutScreenHeader({
  name,
  priceLabel,
}: {
  readonly name: string;
  readonly priceLabel: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <>
      <MiniAppSectionHeading>
        <h2 ref={headingRef} tabIndex={-1}>
          {ORG_MANAGER_LABELS.billingCheckoutTitle}
        </h2>
      </MiniAppSectionHeading>
      <MiniAppRow density="roomy" variant="framed">
        <MiniAppRowStack>
          <strong>{name}</strong>
          <MiniAppRowText muted>{priceLabel}</MiniAppRowText>
        </MiniAppRowStack>
      </MiniAppRow>
    </>
  );
}

/** Whether the checkout has left the billing panel for its own screen. */
export function isCheckoutScreenOpen(checkout: DirectCheckoutState): boolean {
  return checkout.phase.kind !== "idle";
}

export function BillingDirectCheckout({
  checkout,
  disabled,
}: {
  readonly checkout: DirectCheckoutState;
  /** Another billing action is in flight; do not start a competing one. */
  readonly disabled: boolean;
}) {
  const { isEnabled } = useAppFeatureFlags();
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
  const priceLabel = formatPrice(
    option.unitAmount,
    option.currency,
    option.interval,
    option.intervalCount,
  );

  return (
    <MiniAppSection>
      {idle ? (
        <>
          <BillingPurchaseOption
            actionLabel={ORG_MANAGER_LABELS.billingSubscribe}
            disabled={disabled}
            name={option.productName}
            onSelect={checkout.begin}
            priceLabel={priceLabel}
          />
          {/* The hosted-page escape hatch for buyers who prefer not to type
              their card into our inline form; behind a feature flag (off by
              default) while the inline form is the only advertised path. */}
          {isEnabled("stripe-hosted-checkout") ? (
            <HostedCheckoutLink
              disabled={disabled}
              organizationId={checkout.organizationId}
            />
          ) : null}
        </>
      ) : (
        <CheckoutScreenHeader
          name={option.productName}
          priceLabel={priceLabel}
        />
      )}

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

      {/* Stripe's form above asks for the email; this says why. */}
      {idle ? null : (
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.billingEmailHint}
        </MiniAppStatus>
      )}

      {/* Cancel is the way back to the billing panel, so it is offered from
          `starting` on: the screen must never trap the buyer while the form
          loads. Teardown discards a mount that lands after it. */}
      {idle ? null : (
        <MiniAppActions>
          <MiniAppButton disabled={confirming} onClick={checkout.cancel}>
            {ORG_MANAGER_LABELS.billingCancelCheckout}
          </MiniAppButton>
          <MiniAppButton
            disabled={!collecting || disabled || !checkout.billingEmailComplete}
            onClick={checkout.confirm}
          >
            {confirming
              ? ORG_MANAGER_LABELS.billingCheckoutPaying
              : ORG_MANAGER_LABELS.billingCheckoutPay}
          </MiniAppButton>
        </MiniAppActions>
      )}

      {checkout.error ? (
        <MiniAppStatus tone="error">{checkout.error}</MiniAppStatus>
      ) : null}
    </MiniAppSection>
  );
}
