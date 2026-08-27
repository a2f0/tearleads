/**
 * Direct card-checkout capability for org **sync** billing (issue #1654).
 *
 * Distinct from {@link PurchasesCapability}: that one drives a provider-hosted
 * flow (RevenueCat Web Billing / native store sheets) where the provider owns
 * the payment UI. This one mounts the PAYMENT PROVIDER's element into an
 * element we supply, so the surrounding form is ours to style — the trade is
 * that the app must run the confirm step itself.
 *
 * The capability stays provider-agnostic here (no Stripe types): the web shell
 * injects a Stripe-backed implementation, and platforms without one get
 * {@link createUnavailableDirectCheckout} so callers can gate on `isAvailable`
 * rather than branching per platform.
 */

/** Visual tokens the host app passes down so the element matches its theme. */
export interface DirectCheckoutAppearance {
  /** Resolved CSS colors (not var() references — the element is cross-origin). */
  readonly colorBackground: string;
  readonly colorText: string;
  readonly colorTextSecondary: string;
  readonly colorDanger: string;
  readonly colorPrimary: string;
  readonly colorBorder: string;
  readonly fontFamily: string;
  /** Base font size with unit, e.g. "16px". */
  readonly fontSizeBase: string;
  /** Border radius with unit, e.g. "0" for a square-cornered app. */
  readonly borderRadius: string;
  /** Vertical padding inside inputs with unit — drives the row height. */
  readonly inputPaddingBlock: string;
}

/** Outcome of confirming a payment. */
export type DirectCheckoutConfirmation =
  /** The payment succeeded (or is processing and will settle server-side). */
  | { readonly kind: "succeeded" }
  /**
   * The buyer's input was rejected (declined card, failed validation). The
   * element stays mounted so they can correct it; `message` is provider text
   * already localized for display.
   */
  | { readonly kind: "declined"; readonly message: string }
  /** The flow was cancelled locally; nothing was charged. */
  | { readonly kind: "cancelled" };

/** A mounted checkout element; always `unmount()` when done. */
export interface DirectCheckoutSession {
  /**
   * Confirms the payment. Resolves rather than throwing for buyer-facing
   * outcomes so callers need not distinguish exceptions from declines.
   */
  confirm(): Promise<DirectCheckoutConfirmation>;
  /** Tears the element down and releases provider resources. */
  unmount(): void;
}

export interface DirectCheckoutCapability {
  /** False when this platform has no direct-checkout provider (the stub). */
  readonly isAvailable: boolean;
  /**
   * Mounts the payment element into `host` for the given client secret.
   * Rejects with {@link DirectCheckoutUnavailableError} on the stub, and with
   * an ordinary error when the provider script cannot load.
   */
  mount(input: {
    readonly host: HTMLElement;
    readonly clientSecret: string;
    readonly appearance: DirectCheckoutAppearance;
    /** Customer recovery address used by the payment provider's portal. */
    readonly billingEmail?: string;
  }): Promise<DirectCheckoutSession>;
}

/** Thrown when a checkout is attempted on a platform without a provider. */
export class DirectCheckoutUnavailableError extends Error {
  constructor(message = "Direct checkout is not available on this platform") {
    super(message);
    this.name = "DirectCheckoutUnavailableError";
  }
}

/**
 * The no-op capability for platforms with no direct-checkout provider (native
 * shells, or web without a publishable key). Reads degrade quietly so billing
 * UI can gate on `isAvailable`; only an actual mount attempt rejects.
 */
export function createUnavailableDirectCheckout(): DirectCheckoutCapability {
  return {
    isAvailable: false,
    mount() {
      return Promise.reject(new DirectCheckoutUnavailableError());
    },
  };
}
