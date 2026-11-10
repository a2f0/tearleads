import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import { useEffect, useRef } from "react";
import { MiniAppSelectMenu } from "../../../components/mini-app/controls/MiniAppSelectMenu";
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
import { CHECKOUT_LABELS } from "./checkoutCopy";
import type { DirectCheckoutState } from "./useDirectCheckout";
import { useHostedCheckout } from "./useHostedCheckout";
import "./BillingCheckout.css";

/**
 * The in-app card checkout (issue #1654). Unlike the provider-hosted flow,
 * every control here is ours: the plan rows, the plan picker, the Pay button,
 * and the Cancel affordance are app components, and the payment fields mount
 * into the host div styled from the app's own theme tokens.
 */

function priceLabelOf(option: StripeSyncOptionResponse): string {
  return formatPrice(
    option.unitAmount,
    option.currency,
    option.interval,
    option.intervalCount,
  );
}

/**
 * The hosted-page escape hatch, for buyers who prefer not to type their card
 * into our inline form: Stripe's page for the plan the form shows.
 */
function HostedCheckoutLink({
  checkout,
  disabled,
  plan,
}: {
  readonly checkout: DirectCheckoutState;
  readonly disabled: boolean;
  readonly plan: StripeSyncOptionResponse;
}) {
  const hosted = useHostedCheckout({
    onPlanUnavailable: checkout.planUnavailable,
    organizationId: checkout.organizationId,
    priceId: plan.priceId,
  });
  return (
    <>
      <MiniAppActions>
        <MiniAppButton disabled={disabled || hosted.busy} onClick={hosted.open}>
          {hosted.busy
            ? CHECKOUT_LABELS.payOnStripeStarting
            : CHECKOUT_LABELS.payOnStripe}
        </MiniAppButton>
      </MiniAppActions>
      {hosted.unavailable ? (
        <MiniAppStatus className="org-manager-hint">
          {CHECKOUT_LABELS.payOnStripeUnavailable}
        </MiniAppStatus>
      ) : null}
    </>
  );
}

/**
 * Switches the open form between the offered plans; the form re-prices in
 * place and keeps what the buyer typed. Locked while a payment is running.
 */
function CheckoutPlanPicker({
  checkout,
  plan,
}: {
  readonly checkout: DirectCheckoutState;
  readonly plan: StripeSyncOptionResponse;
}) {
  return (
    <MiniAppSelectMenu
      ariaLabel={CHECKOUT_LABELS.plan}
      disabled={checkout.phase.kind !== "collecting"}
      onChange={(priceId) => {
        const option = checkout.options.find(
          (candidate) => candidate.priceId === priceId,
        );
        if (option) {
          checkout.changePlan(option);
        }
      }}
      options={checkout.options.map((option) => ({
        id: option.priceId,
        label: option.productName,
        secondaryLabel: priceLabelOf(option),
        triggerLabel: `${option.productName} · ${priceLabelOf(option)}`,
      }))}
      value={plan.priceId}
    />
  );
}

/**
 * The checkout screen's header: the billing panel hides everything else once
 * Subscribe is clicked, so this names the screen and restates what is being
 * bought, with a picker when another plan is on offer. Focus moves to the
 * heading on arrival, as on any new screen.
 */
function CheckoutScreenHeader({
  checkout,
  plan,
}: {
  readonly checkout: DirectCheckoutState;
  readonly plan: StripeSyncOptionResponse;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <>
      <MiniAppSectionHeading>
        <h2 ref={headingRef} tabIndex={-1}>
          {CHECKOUT_LABELS.title}
        </h2>
      </MiniAppSectionHeading>
      <MiniAppRow density="roomy" variant="framed">
        {checkout.options.length > 1 ? (
          <CheckoutPlanPicker checkout={checkout} plan={plan} />
        ) : (
          <MiniAppRowStack>
            <strong>{plan.productName}</strong>
            <MiniAppRowText muted>{priceLabelOf(plan)}</MiniAppRowText>
          </MiniAppRowStack>
        )}
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
        {CHECKOUT_LABELS.cancel}
      </MiniAppButton>
      <MiniAppButton
        disabled={!collecting || disabled || !checkout.billingEmailComplete}
        onClick={checkout.confirm}
      >
        {confirming ? CHECKOUT_LABELS.paying : CHECKOUT_LABELS.pay}
      </MiniAppButton>
    </MiniAppActions>
  );
}

/**
 * The checkout screen while the provider form loads: a whole-panel busy
 * state, like the other mini-app loading screens. Cancel stays offered, so
 * the screen never traps the buyer; teardown discards a mount that lands
 * after it.
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
      description={CHECKOUT_LABELS.startingDescription}
      title={CHECKOUT_LABELS.starting}
    >
      <MiniAppButton onClick={onCancel} ref={cancelRef}>
        {CHECKOUT_LABELS.cancel}
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

/** One row per offered plan, smallest first; Subscribe opens its form. */
function CheckoutIdleOffer({
  checkout,
  disabled,
}: {
  readonly checkout: DirectCheckoutState;
  readonly disabled: boolean;
}) {
  return checkout.options.map((option) => (
    <BillingPurchaseOption
      actionLabel={ORG_MANAGER_LABELS.billingSubscribe}
      disabled={disabled}
      key={option.priceId}
      name={option.productName}
      onSelect={() => checkout.begin(option)}
      priceLabel={priceLabelOf(option)}
    />
  ));
}

/**
 * The header, provider host, email hint, and actions. Always mounted while
 * the flow is live so the element has a stable host to attach to; while the
 * form loads it stays laid out but invisible behind the loading panel.
 */
function CheckoutScreen({
  checkout,
  disabled,
}: {
  readonly checkout: DirectCheckoutState;
  readonly disabled: boolean;
}) {
  const { isEnabled } = useAppFeatureFlags();
  const idle = checkout.phase.kind === "idle";
  const loading = isCheckoutLoading(checkout);
  const plan = idle || loading ? null : checkout.chosen;
  return (
    <div
      className={classNames(
        "org-manager-checkout-screen",
        loading && "org-manager-checkout-screen--loading",
      )}
    >
      {/* Mounting on reveal moves focus to the heading. */}
      {plan ? <CheckoutScreenHeader checkout={checkout} plan={plan} /> : null}
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
      {plan ? (
        <MiniAppStatus className="org-manager-hint">
          {CHECKOUT_LABELS.emailHint}
        </MiniAppStatus>
      ) : null}
      {plan ? (
        <CheckoutScreenActions checkout={checkout} disabled={disabled} />
      ) : null}
      {/* Stripe's own page for the same plan; behind a feature flag (off by
          default) while the inline form is the only advertised path. */}
      {plan && isEnabled("stripe-hosted-checkout") ? (
        <HostedCheckoutLink
          checkout={checkout}
          disabled={disabled}
          plan={plan}
        />
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
  if (!checkout.available) {
    return null;
  }
  if (checkout.options.length === 0) {
    return checkout.error ? (
      <MiniAppSection>
        <MiniAppStatus tone="error">{checkout.error}</MiniAppStatus>
      </MiniAppSection>
    ) : null;
  }
  const idle = checkout.phase.kind === "idle";
  const loading = isCheckoutLoading(checkout);

  return (
    <MiniAppSection
      className={loading ? "org-manager-checkout--loading" : undefined}
    >
      {idle ? (
        <CheckoutIdleOffer checkout={checkout} disabled={disabled} />
      ) : null}
      {loading ? <CheckoutLoadingPanel onCancel={checkout.cancel} /> : null}
      <CheckoutScreen checkout={checkout} disabled={disabled} />
      {checkout.error ? (
        <MiniAppStatus tone="error">{checkout.error}</MiniAppStatus>
      ) : null}
    </MiniAppSection>
  );
}
