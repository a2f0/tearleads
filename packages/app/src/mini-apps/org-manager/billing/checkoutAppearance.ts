import type { DirectCheckoutAppearance } from "@tearleads/client-sdk";

/**
 * Resolves the app's theme tokens into concrete CSS for the payment element
 * (issue #1654).
 *
 * The element renders in a cross-origin iframe, so it cannot read this
 * document's custom properties — `var(--color-dark)` would arrive as an
 * unresolvable string. Custom properties also compute to their *authored*
 * token (`1rem`, or an unevaluated `color-mix(...)`), not to a used value, so
 * reading them directly is not enough either.
 *
 * Both problems are solved the same way: apply the token references to a
 * throwaway probe element inside the billing panel and read back the
 * *computed* values, which the engine has resolved to `rgb(...)` and `px`.
 * Reading through the panel keeps the result correct for whatever theme is
 * active, including themes added later.
 */

/** Rendered when a token resolves to nothing (probe detached, jsdom, …). */
const FALLBACK: DirectCheckoutAppearance = {
  colorBackground: "#ffffff",
  colorText: "#333333",
  colorTextSecondary: "#666666",
  colorDanger: "#b00020",
  colorPrimary: "#333333",
  colorBorder: "#cccccc",
  fontFamily: "monospace",
  fontSizeBase: "16px",
  borderRadius: "0",
  inputPaddingBlock: "8px",
};

function firstNonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Reads the resolved appearance for a payment element mounted inside `host`.
 * Never throws: an environment without layout (or a detached host) falls back
 * to the neutral defaults above rather than failing the checkout.
 */
export function readCheckoutAppearance(
  host: HTMLElement | null,
): DirectCheckoutAppearance {
  const ownerDocument = host?.ownerDocument;
  const view = ownerDocument?.defaultView;
  if (!host || !ownerDocument || !view) {
    return FALLBACK;
  }

  const probe = ownerDocument.createElement("div");
  // Out of flow and invisible, but still styled — computed values resolve for
  // a `display:none` element, and this never affects layout.
  probe.style.display = "none";
  probe.style.color = "var(--color-dark)";
  probe.style.backgroundColor = "var(--color-light)";
  probe.style.borderColor = "var(--color-hairline)";
  probe.style.outlineColor = "var(--color-danger)";
  probe.style.caretColor = "var(--emphasis-surface)";
  probe.style.fontFamily = "var(--tearleads-font-family)";
  probe.style.fontSize = "var(--font-size-md)";
  probe.style.paddingTop = "var(--control-padding-block)";
  host.appendChild(probe);

  try {
    const computed = view.getComputedStyle(probe);
    const text = firstNonEmpty(computed.color, FALLBACK.colorText);
    return {
      colorBackground: firstNonEmpty(
        computed.backgroundColor,
        FALLBACK.colorBackground,
      ),
      colorText: text,
      // The token set has no dedicated secondary text color; the app renders
      // muted text as the foreground at reduced opacity, which an iframe
      // cannot inherit — so pass the same color and let Stripe's own
      // secondary styling apply.
      colorTextSecondary: text,
      colorDanger: firstNonEmpty(computed.outlineColor, FALLBACK.colorDanger),
      colorPrimary: firstNonEmpty(computed.caretColor, FALLBACK.colorPrimary),
      colorBorder: firstNonEmpty(computed.borderTopColor, FALLBACK.colorBorder),
      fontFamily: firstNonEmpty(computed.fontFamily, FALLBACK.fontFamily),
      fontSizeBase: firstNonEmpty(computed.fontSize, FALLBACK.fontSizeBase),
      // The app is square-cornered (packages/ui sets border-radius: 0).
      borderRadius: "0",
      inputPaddingBlock: firstNonEmpty(
        computed.paddingTop,
        FALLBACK.inputPaddingBlock,
      ),
    };
  } finally {
    probe.remove();
  }
}
