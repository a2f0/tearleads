import {
  loadStripe,
  type Stripe,
  type StripeElements,
} from "@stripe/stripe-js";
import {
  createUnavailableDirectCheckout,
  type DirectCheckoutAppearance,
  type DirectCheckoutCapability,
  type DirectCheckoutConfirmation,
  type DirectCheckoutSession,
} from "@tearleads/client-sdk";

/**
 * Stripe-backed {@link DirectCheckoutCapability} for the web shell (issue
 * #1654): mounts a Payment Element into an element the app owns, so the card
 * form inherits the app's own look rather than the provider's.
 *
 * The fields themselves remain Stripe-hosted iframes — that is what keeps us
 * in PCI SAQ A — but Stripe's Appearance API accepts the app's resolved theme
 * tokens, including font family and input padding, which the RevenueCat Web
 * Billing checkout does not expose.
 */

/** Publishable key, inlined at build time by `bun build --env='BUN_PUBLIC_*'`. */
function readPublishableKey(): string | undefined {
  const value = process.env.BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Maps the app's resolved theme tokens onto Stripe's Appearance API. Values
 * must be concrete CSS (not `var(--…)`) because the element renders in a
 * cross-origin iframe that cannot read this document's custom properties.
 */
function toStripeAppearance(appearance: DirectCheckoutAppearance) {
  return {
    theme: "stripe" as const,
    variables: {
      colorBackground: appearance.colorBackground,
      colorText: appearance.colorText,
      colorTextSecondary: appearance.colorTextSecondary,
      colorDanger: appearance.colorDanger,
      colorPrimary: appearance.colorPrimary,
      fontFamily: appearance.fontFamily,
      fontSizeBase: appearance.fontSizeBase,
      borderRadius: appearance.borderRadius,
    },
    rules: {
      ".Input": {
        border: `1px solid ${appearance.colorBorder}`,
        paddingTop: appearance.inputPaddingBlock,
        paddingBottom: appearance.inputPaddingBlock,
        boxShadow: "none",
      },
      ".Input:focus": {
        border: `1px solid ${appearance.colorPrimary}`,
        outline: "none",
        boxShadow: "none",
      },
      ".Label": { color: appearance.colorTextSecondary },
    },
  };
}

/**
 * Normalizes a confirm outcome. Stripe reports buyer-facing problems
 * (`card_error`, `validation_error`) as a resolved error rather than a throw;
 * everything else is a real failure the caller should surface as such.
 */
function toConfirmation(
  error: { type?: string; message?: string } | undefined,
): DirectCheckoutConfirmation {
  if (!error) {
    return { kind: "succeeded" };
  }
  if (error.type === "card_error" || error.type === "validation_error") {
    return {
      kind: "declined",
      message: error.message ?? "Your card could not be charged.",
    };
  }
  throw new Error(error.message ?? "The payment could not be completed.");
}

/**
 * Where Stripe sends the buyer back if a 3-D Secure step insists on a
 * full-page redirect rather than the usual modal. Read at confirm time, not
 * at mount: the panel's URL can change while the form is open, and there is
 * no `location` outside a browser.
 */
function currentReturnUrl(): string | undefined {
  return globalThis.location?.href;
}

function createSession(
  stripe: Stripe,
  elements: StripeElements,
): DirectCheckoutSession {
  let unmounted = false;
  return {
    async confirm() {
      if (unmounted) {
        return { kind: "cancelled" };
      }
      const returnUrl = currentReturnUrl();
      const { error } = await stripe.confirmPayment({
        elements,
        // Stay in the panel: only redirect for payment methods that require
        // it, which a card does not — the server pins the subscription to
        // card, so nothing redirect-based can be offered here.
        redirect: "if_required",
        // Stripe.js rejects the confirm outright if a redirect DOES become
        // necessary and no return_url was given, which the buyer would see
        // as a generic failure. Returning to the current page is right: the
        // webhook has already recorded the outcome by the time they land.
        ...(returnUrl ? { confirmParams: { return_url: returnUrl } } : {}),
      });
      // A confirm that resolves after the caller tore the element down must
      // not be reported as a live success.
      return unmounted ? { kind: "cancelled" } : toConfirmation(error);
    },
    unmount() {
      unmounted = true;
      // Destroying the element releases the iframe; the Elements group is
      // garbage once its only element is gone.
      elements.getElement("payment")?.destroy();
    },
  };
}

export function createWebDirectCheckout(
  loadStripeImpl: typeof loadStripe = loadStripe,
): DirectCheckoutCapability {
  const publishableKey = readPublishableKey();
  if (!publishableKey) {
    return createUnavailableDirectCheckout();
  }

  // Load once per capability, not per mount: the script is cached by Stripe's
  // loader, but the promise keeps concurrent mounts from racing it.
  let stripePromise: Promise<Stripe | null> | undefined;

  return {
    isAvailable: true,
    async mount({ host, clientSecret, appearance }) {
      stripePromise = stripePromise ?? loadStripeImpl(publishableKey);
      const stripe = await stripePromise;
      if (!stripe) {
        // A failed load is transient (blocked script, offline); clear the
        // cached promise so a retry can load again.
        stripePromise = undefined;
        throw new Error("The payment form could not be loaded.");
      }
      const elements = stripe.elements({
        clientSecret,
        appearance: toStripeAppearance(appearance),
      });
      const payment = elements.create("payment");
      payment.mount(host);
      return createSession(stripe, elements);
    },
  };
}
