import type { Stripe, StripeElements } from "@stripe/stripe-js";
// The `/pure` entry is deliberate: importing the main entry downloads
// Stripe.js (and its fraud-signal beacons) as an import side effect, which
// would run at app startup for every visitor since this module is imported
// from the web shell's entry point. `/pure` defers the fetch to the first
// `loadStripe` call, i.e. the first time a buyer opens the checkout. The type
// import above has no runtime cost and stays on the main entry.
import { loadStripe } from "@stripe/stripe-js/pure";
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
 * Whether the resolved surface is dark, so the Payment Element's BASE theme can
 * match. Classifies the computed `rgb(...)`/`rgba(...)` form via a Rec. 601 luma
 * threshold. Callers pass the value through {@link toStripeColor} first, so an
 * sRGB `color(srgb …)` surface arrives here already converted to `rgb(...)`; any
 * form that conversion leaves untouched — the `#ffffff` fallback, or a non-sRGB
 * `oklch(...)`/`lab(...)` — does not match and falls back to light rather than
 * being misread by the numeric channel extraction.
 */
function isDarkSurface(colorBackground: string): boolean {
  if (!/^rgba?\(/i.test(colorBackground.trim())) {
    return false;
  }
  const channels = colorBackground.match(/[\d.]+/g);
  if (!channels || channels.length < 3) {
    return false;
  }
  // A fully transparent surface (`rgba(0, 0, 0, 0)`, e.g. an unresolved token)
  // has no colour of its own; reading its r/g/b would misread it as black-dark,
  // so treat alpha 0 as light.
  if (channels.length >= 4 && Number(channels[3]) === 0) {
    return false;
  }
  const r = Number(channels[0]);
  const g = Number(channels[1]);
  const b = Number(channels[2]);
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/**
 * Stripe's Appearance API parses only the legacy colour forms — hex, `rgb()`,
 * `rgba()`. Recent browsers serialize `color-mix()` / `color()` tokens as
 * `color(srgb r g b[ / a])` with 0–1 channels, and Stripe rejects that value
 * outright: it dropped the input border AND knocked the card-number icon back
 * onto the light base theme despite `theme: "night"` (dark-on-dark). Our tokens
 * all resolve in the sRGB space (`color-mix(in srgb, …)` over hex), so convert
 * that one modern form back to `rgb()` / `rgba()`. Anything already in a legacy
 * form, or in a colour space we do not convert (oklch, lab, display-p3), passes
 * through untouched — Stripe would still reject the latter, but no token
 * produces it today.
 */
function toStripeColor(value: string): string {
  const trimmed = value.trim();
  const srgb =
    /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/i.exec(
      trimmed,
    );
  if (!srgb) {
    return trimmed;
  }
  // A successful match guarantees groups 1–3, so `raw` is never actually
  // undefined; the `| undefined` only satisfies noUncheckedIndexedAccess (an
  // absent group would clamp to NaN, which no serialization produces).
  const channel = (raw: string | undefined): number =>
    Math.round(Math.min(1, Math.max(0, Number(raw))) * 255);
  const r = channel(srgb[1]);
  const g = channel(srgb[2]);
  const b = channel(srgb[3]);
  if (srgb[4] === undefined) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  const alpha = Math.min(1, Math.max(0, Number(srgb[4])));
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

/**
 * Maps the app's resolved theme tokens onto Stripe's Appearance API. Values
 * must be concrete CSS (not `var(--…)`) because the element renders in a
 * cross-origin iframe that cannot read this document's custom properties, and
 * every colour is run through {@link toStripeColor} so a `color(srgb …)` token
 * never reaches Stripe as an unparseable value.
 */
function toStripeAppearance(appearance: DirectCheckoutAppearance) {
  const colorBackground = toStripeColor(appearance.colorBackground);
  const colorText = toStripeColor(appearance.colorText);
  const colorTextSecondary = toStripeColor(appearance.colorTextSecondary);
  const colorDanger = toStripeColor(appearance.colorDanger);
  const colorPrimary = toStripeColor(appearance.colorPrimary);
  const colorBorder = toStripeColor(appearance.colorBorder);
  return {
    // Base theme by mode. The Payment Element's built-in defaults come from
    // this base, and our variable overrides only refine on top. Keeping
    // "stripe" (a LIGHT base) on a dark surface left the card icon dark-on-dark;
    // "night" gives it the light-tuned defaults a dark surface needs.
    theme: isDarkSurface(colorBackground)
      ? ("night" as const)
      : ("stripe" as const),
    variables: {
      colorBackground,
      colorText,
      colorTextSecondary,
      colorDanger,
      colorPrimary,
      // Pin the icon colour explicitly. The card-number field's icon comes from
      // the base theme, and it stayed dark even under "night"; tying it to the
      // text colour makes it track the surface in both modes rather than
      // trusting the theme default.
      colorIcon: colorText,
      fontFamily: appearance.fontFamily,
      fontSizeBase: appearance.fontSizeBase,
      borderRadius: appearance.borderRadius,
    },
    rules: {
      ".Input": {
        border: `1px solid ${colorBorder}`,
        paddingTop: appearance.inputPaddingBlock,
        paddingBottom: appearance.inputPaddingBlock,
        boxShadow: "none",
      },
      ".Input:focus": {
        border: `1px solid ${colorPrimary}`,
        outline: "none",
        boxShadow: "none",
      },
      ".Label": { color: colorTextSecondary },
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
  billingEmail?: string,
): DirectCheckoutSession {
  let unmounted = false;
  return {
    async confirm() {
      if (unmounted) {
        return { kind: "cancelled" };
      }
      const returnUrl = currentReturnUrl();
      const confirmParams = {
        ...(billingEmail
          ? {
              payment_method_data: {
                billing_details: { email: billingEmail },
              },
            }
          : {}),
        ...(returnUrl ? { return_url: returnUrl } : {}),
      };
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
        ...(returnUrl || billingEmail ? { confirmParams } : {}),
      });
      // Check the unmount BEFORE mapping: `toConfirmation` throws for a
      // non-buyer error, which would reject instead of honoring the
      // cancelled-on-unmount contract. A succeeded confirm is the one case
      // that still has to be reported (see below) — it charged the card.
      if (unmounted && error) {
        return { kind: "cancelled" };
      }
      const outcome = toConfirmation(error);
      // An unmount racing a confirm normally means the buyer walked away, so
      // report cancellation. But a confirm that already CHARGED the card is
      // not cancellable — saying so would be a lie about money. Report the
      // success; the caller's own staleness check may still drop it, which is
      // safe because the webhook, not this return value, is what grants the
      // entitlement.
      if (unmounted && outcome.kind !== "succeeded") {
        return { kind: "cancelled" };
      }
      return outcome;
    },
    unmount() {
      unmounted = true;
      // Destroying the element releases the iframe; the Elements group is
      // garbage once its only element is gone.
      elements.getElement("payment")?.destroy();
    },
  };
}

/**
 * Just the call signature of `loadStripe`, so tests can inject a plain
 * function: the `/pure` entry's export also carries `setLoadParameters`,
 * which this capability never calls.
 */
type LoadStripeFn = (publishableKey: string) => Promise<Stripe | null>;

export function createWebDirectCheckout(
  loadStripeImpl: LoadStripeFn = loadStripe,
): DirectCheckoutCapability {
  const publishableKey = readPublishableKey();
  if (!publishableKey) {
    return createUnavailableDirectCheckout();
  }

  // Load once per capability, not per mount: the promise keeps concurrent
  // mounts from racing the script fetch.
  let stripePromise: Promise<Stripe | null> | undefined;

  return {
    isAvailable: true,
    async mount({ host, clientSecret, appearance, billingEmail }) {
      stripePromise = stripePromise ?? loadStripeImpl(publishableKey);
      // `loadStripe` REJECTS when the script cannot be fetched (blocked by an
      // extension, offline) and resolves null only where there is no `window`.
      // Both must become the same buyer-facing failure rather than an
      // unhandled rejection. Clearing the cached promise lets this capability
      // try again, though stripe-js memoizes its own script load internally,
      // so a retry within the same page will usually replay the failure — a
      // reload is the real remedy, and the message says "could not be loaded"
      // rather than promising a retry will work.
      let stripe: Stripe | null;
      try {
        stripe = await stripePromise;
      } catch (loadError) {
        stripePromise = undefined;
        console.error("Failed to load the Stripe script:", loadError);
        throw new Error("The payment form could not be loaded.");
      }
      if (!stripe) {
        stripePromise = undefined;
        throw new Error("The payment form could not be loaded.");
      }
      const elements = stripe.elements({
        clientSecret,
        appearance: toStripeAppearance(appearance),
      });
      const normalizedEmail = billingEmail?.trim();
      const payment = elements.create(
        "payment",
        normalizedEmail
          ? { fields: { billingDetails: { email: "never" } } }
          : undefined,
      );
      payment.mount(host);
      return createSession(stripe, elements, normalizedEmail);
    },
  };
}
