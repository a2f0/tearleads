import type { SVGProps } from "react";

/**
 * The Tearleads mark: a "T" over an "L:" glyph. Mirrors assets/logo.svg but is
 * an inline React component so it can be dropped into JSX (headers, etc.)
 * without any SVG bundler/loader configuration.
 *
 * The two glyph tones are driven by --tearleads-logo-primary (the "L:") and
 * --tearleads-logo-secondary (the "T"), falling back to the brand greys. The
 * default greys are legible on light surfaces; contexts with a dark background
 * (e.g. the header) override the variables to light tones so the mark stays
 * readable. See .tearleads-header in styles.css.
 */
export function TearleadsLogo(props: SVGProps<SVGSVGElement>) {
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
      {/* L (right vertical bar) */}
      <rect
        fill="var(--tearleads-logo-primary, #555)"
        height="21"
        width="9"
        x="24"
        y="12"
      />
      {/* Bottom square (colon) */}
      <rect
        fill="var(--tearleads-logo-primary, #555)"
        height="9"
        width="9"
        x="0"
        y="24"
      />
      {/* Top square (colon) */}
      <rect
        fill="var(--tearleads-logo-primary, #555)"
        height="9"
        width="9"
        x="0"
        y="12"
      />
      {/* T (horizontal bar) */}
      <rect
        fill="var(--tearleads-logo-secondary, #999)"
        height="9"
        width="33"
        x="0"
        y="0"
      />
      {/* T (vertical bar) */}
      <rect
        fill="var(--tearleads-logo-secondary, #999)"
        height="33"
        width="9"
        x="12"
        y="0"
      />
    </svg>
  );
}
