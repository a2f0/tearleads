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
   * Pays: validates the form, then calls `startPayment`, which starts the
   * purchase on the server and returns the provider client secret that
   * confirms it, then confirms that payment. Nothing exists server-side until
   * the buyer pays, so a form that is opened and abandoned costs nothing.
   *
   * Resolves rather than throwing for buyer-facing outcomes (a declined card,
   * failed validation) so callers need not distinguish exceptions from
   * declines; a declined payment can be retried with another `confirm`.
   * Rejects with `startPayment`'s error when the server refuses, and with a
   * provider error otherwise.
   */
  confirm(
    startPayment: () => Promise<string>,
  ): Promise<DirectCheckoutConfirmation>;
  /** Tears the element down and releases provider resources. */
  unmount(): void;
}

export interface DirectCheckoutCapability {
  /** False when this platform has no direct-checkout provider (the stub). */
  readonly isAvailable: boolean;
  /**
   * Mounts the provider's billing-email and payment elements into `host`
   * for a recurring purchase of `price`, before anything exists on the
   * server. Resolves once the elements are attached; the provider form may
   * still be loading, which `onReady` and `onLoadError` report.
   * Rejects with {@link DirectCheckoutUnavailableError} on the stub, and with
   * an ordinary error when the provider script cannot load.
   */
  mount(input: {
    readonly host: HTMLElement;
    /**
     * What the form shows and the first payment charges. The provider does
     * not check it against what the server starts, so `startPayment` must
     * start exactly this price.
     */
    readonly price: {
      /** Amount in the currency's minor unit, e.g. 500 for $5.00. */
      readonly amount: number;
      /** ISO 4217 code as the provider reports it, e.g. "usd". */
      readonly currency: string;
    };
    readonly appearance: DirectCheckoutAppearance;
    /**
     * The provider form collects the billing email (the customer recovery
     * address the provider's portal uses) above the card fields. Called with
     * the email once it is complete and valid, and with `null` while it is
     * not, so the host can gate its Pay control; `confirm` sends the latest
     * complete email itself.
     */
    readonly onBillingEmailChange: (email: string | null) => void;
    /**
     * Called once, when every provider element has rendered and accepts
     * input. `host` must stay laid out (not `display: none`) until then,
     * because the provider sizes its frames from it.
     */
    readonly onReady: () => void;
    /**
     * Called with an error when the provider form fails to load after
     * mounting. The session can no longer be used; the host should unmount it.
     */
    readonly onLoadError: (error: unknown) => void;
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
