import type { SVGProps } from "react";

/**
 * The SymCrypt mark: an "S" nested inside a "C" glyph. Mirrors assets/logo.svg but is
 * an inline React component so it can be dropped into JSX (headers, etc.)
 * without any SVG bundler/loader configuration.
 *
 * The two glyph tones are driven by --symcrypt-logo-primary (the "C") and
 * --symcrypt-logo-secondary (the "S"), falling back to the brand greys. The
 * default greys are legible on light surfaces; contexts with a dark background
 * (e.g. the header) override the variables to light tones so the mark stays
 * readable. See .symcrypt-header in styles.css.
 */
export function SymCryptLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      height="33"
      viewBox="0 0 33 33"
      width="33"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* C */}
      <rect
        fill="var(--symcrypt-logo-primary, #555)"
        height="6"
        width="33"
        x="0"
        y="0"
      />
      <rect
        fill="var(--symcrypt-logo-primary, #555)"
        height="33"
        width="6"
        x="0"
        y="0"
      />
      <rect
        fill="var(--symcrypt-logo-primary, #555)"
        height="6"
        width="33"
        x="0"
        y="27"
      />
      {/* S */}
      <rect
        fill="var(--symcrypt-logo-secondary, #999)"
        height="6"
        width="23"
        x="10"
        y="7"
      />
      <rect
        fill="var(--symcrypt-logo-secondary, #999)"
        height="13"
        width="6"
        x="10"
        y="7"
      />
      <rect
        fill="var(--symcrypt-logo-secondary, #999)"
        height="6"
        width="23"
        x="10"
        y="14"
      />
      <rect
        fill="var(--symcrypt-logo-secondary, #999)"
        height="13"
        width="6"
        x="27"
        y="14"
      />
      <rect
        fill="var(--symcrypt-logo-secondary, #999)"
        height="6"
        width="23"
        x="10"
        y="21"
      />
    </svg>
  );
}
