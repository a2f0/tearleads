import { useEffect, useRef } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatePanel,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { classNames } from "../../../components/shared/classNames";
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

/** The checkout screen's Cancel and Pay buttons. */
function CheckoutScreenActions({
  checkout,
  disabled,
}: {
  readonly checkout: DirectCheckoutState;
  readonly disabled: boolean;
}) {
  const collecting = checkout.phase.kind === "collecting";
  const confirming = checkout.phase.kind === "confirming";
  return (
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
  );
}

/**
 * The checkout screen while the server checkout and the provider form load:
 * a whole-panel busy state, like the other mini-app loading screens. Cancel
 * stays offered, so the screen never traps the buyer; teardown discards a
 * mount that lands after it.
 */
function CheckoutLoadingPanel({ onCancel }: { readonly onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The Subscribe button that had focus is gone; keep focus on this screen.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <MiniAppStatePanel
      busy
      description={ORG_MANAGER_LABELS.billingCheckoutStartingDescription}
      title={ORG_MANAGER_LABELS.billingCheckoutStarting}
    >
      <MiniAppButton onClick={onCancel} ref={cancelRef}>
        {ORG_MANAGER_LABELS.billingCancelCheckout}
      </MiniAppButton>
    </MiniAppStatePanel>
  );
}

/** Whether the checkout has left the billing panel for its own screen. */
export function isCheckoutScreenOpen(checkout: DirectCheckoutState): boolean {
  return checkout.phase.kind !== "idle";
}

/** Whether the checkout screen is showing its loading state. */
export function isCheckoutLoading(checkout: DirectCheckoutState): boolean {
  return checkout.phase.kind === "starting";
}

function CheckoutIdleOffer({
  checkout,
  disabled,
  name,
  priceLabel,
}: {
  readonly checkout: DirectCheckoutState;
  readonly disabled: boolean;
  readonly name: string;
  readonly priceLabel: string;
}) {
  const { isEnabled } = useAppFeatureFlags();
  return (
    <>
      <BillingPurchaseOption
        actionLabel={ORG_MANAGER_LABELS.billingSubscribe}
        disabled={disabled}
        name={name}
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
  );
}

/**
 * The header, provider host, email hint, and actions. Always mounted while
 * the flow is live so the element has a stable host to attach to; while the
 * form loads it stays laid out but invisible behind the loading panel.
 */
function CheckoutScreen({
  checkout,
  disabled,
  name,
  priceLabel,
}: {
  readonly checkout: DirectCheckoutState;
  readonly disabled: boolean;
  readonly name: string;
  readonly priceLabel: string;
}) {
  const idle = checkout.phase.kind === "idle";
  const loading = isCheckoutLoading(checkout);
  const shown = !idle && !loading;
  return (
    <div
      className={classNames(
        "org-manager-checkout-screen",
        loading && "org-manager-checkout-screen--loading",
      )}
    >
      {/* Mounting on reveal moves focus to the heading. */}
      {shown ? (
        <CheckoutScreenHeader name={name} priceLabel={priceLabel} />
      ) : null}
      <div
        className="org-manager-direct-checkout"
        ref={checkout.hostRef}
        // Hidden rather than unmounted between attempts: unmounting would
        // destroy the node the provider element is attached to. Displayed
        // from `starting` on, because that is exactly when the element
        // mounts and providers size their iframe off the host — mounting
        // into a display:none node yields a collapsed or unsized form.
        hidden={idle}
      />
      {/* Stripe's form above asks for the email; this says why. */}
      {shown ? (
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.billingEmailHint}
        </MiniAppStatus>
      ) : null}
      {shown ? (
        <CheckoutScreenActions checkout={checkout} disabled={disabled} />
      ) : null}
    </div>
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
  const { option } = checkout;
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
  const idle = checkout.phase.kind === "idle";
  const loading = isCheckoutLoading(checkout);
  const priceLabel = formatPrice(
    option.unitAmount,
    option.currency,
    option.interval,
    option.intervalCount,
  );

  return (
    <MiniAppSection
      className={loading ? "org-manager-checkout--loading" : undefined}
    >
      {idle ? (
        <CheckoutIdleOffer
          checkout={checkout}
          disabled={disabled}
          name={option.productName}
          priceLabel={priceLabel}
        />
      ) : null}
      {loading ? <CheckoutLoadingPanel onCancel={checkout.cancel} /> : null}
      <CheckoutScreen
        checkout={checkout}
        disabled={disabled}
        name={option.productName}
        priceLabel={priceLabel}
      />
      {checkout.error ? (
        <MiniAppStatus tone="error">{checkout.error}</MiniAppStatus>
      ) : null}
    </MiniAppSection>
  );
}
