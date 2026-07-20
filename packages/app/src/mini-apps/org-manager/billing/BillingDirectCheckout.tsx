import {
  MiniAppSection,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { ORG_MANAGER_LABELS } from "../labels";
import type { DirectCheckoutState } from "./useDirectCheckout";
import "./BillingCheckout.css";

/**
 * The in-app card checkout (issue #1654). Unlike the provider-hosted flow,
 * every control here is ours: the price row, the Pay button, and the Cancel
 * affordance are app components, and the payment fields mount into the host
 * div styled from the app's own theme tokens.
 */

/**
 * Whether this runtime knows the currency well enough to place the decimal
 * point. `Intl.supportedValuesOf` is the only way to ask; a code missing from
 * it formats with a default exponent that may not be the currency's own.
 */
function isKnownCurrency(currencyCode: string): boolean {
  try {
    return Intl.supportedValuesOf("currency").includes(currencyCode);
  } catch {
    // No `supportedValuesOf` in this runtime: fall back to the malformed-code
    // check alone rather than refusing to price anything.
    try {
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
      });
      return true;
    } catch {
      return false;
    }
  }
}

export function formatPrice(
  unitAmount: number | null,
  currency: string,
  interval: string | null,
): string {
  if (unitAmount === null) {
    return "";
  }
  const currencyCode = currency.toUpperCase();
  // `Intl` throws only on a MALFORMED code — it accepts any well-formed
  // three-letter code and silently formats it with 2 fraction digits. That is
  // the dangerous case: an unrecognized zero-decimal currency would render at
  // 1/100 of its true price. So check that the runtime actually knows the
  // code, and treat "well-formed but unknown" the same as malformed.
  if (!isKnownCurrency(currencyCode)) {
    // Name the currency without an amount rather than state a wrong price;
    // the provider's own form shows the authoritative figure.
    return currencyCode;
  }
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
  });
  // Stripe reports MINOR units, and the minor-unit exponent is per currency —
  // 2 for USD/EUR but 0 for JPY/KRW. Intl formats, it does not convert, so
  // read the exponent from the resolved options rather than assuming 100.
  const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const amount = formatter.format(unitAmount / 10 ** exponent);
  return interval ? `${amount}/${interval}` : amount;
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
  if (!checkout.available || !option) {
    return null;
  }
  const collecting = phase.kind === "collecting";
  const confirming = phase.kind === "confirming";
  const starting = phase.kind === "starting";
  const idle = phase.kind === "idle";

  return (
    <MiniAppSection>
      {idle ? (
        <MiniAppRowButton disabled={disabled} onClick={checkout.begin}>
          <MiniAppRowStack>
            <strong>{option.productName}</strong>
            <MiniAppRowText muted>
              {formatPrice(option.unitAmount, option.currency, option.interval)}
            </MiniAppRowText>
          </MiniAppRowStack>
          <MiniAppRowText>{ORG_MANAGER_LABELS.billingSubscribe}</MiniAppRowText>
        </MiniAppRowButton>
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
        <>
          <MiniAppRowButton
            disabled={confirming || disabled}
            onClick={checkout.confirm}
          >
            <MiniAppRowText>
              {confirming
                ? ORG_MANAGER_LABELS.billingCheckoutPaying
                : ORG_MANAGER_LABELS.billingCheckoutPay}
            </MiniAppRowText>
          </MiniAppRowButton>
          <MiniAppRowButton disabled={confirming} onClick={checkout.cancel}>
            <MiniAppRowText>
              {ORG_MANAGER_LABELS.billingCancelCheckout}
            </MiniAppRowText>
          </MiniAppRowButton>
        </>
      ) : null}

      {checkout.error ? (
        <MiniAppStatus tone="error">{checkout.error}</MiniAppStatus>
      ) : null}
    </MiniAppSection>
  );
}
