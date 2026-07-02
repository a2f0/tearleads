import type { SVGProps } from "react";

/**
 * The Tearleads mark: a "T" over an "L:" glyph. Mirrors assets/logo.svg but is
 * an inline React component so it can be dropped into JSX (headers, etc.)
 * without any SVG bundler/loader configuration. Colors default to the two
 * brand greys; `currentColor` is intentionally not used so the mark stays
 * legible on both light and dark backgrounds.
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
      <rect fill="#555" height="21" width="9" x="24" y="12" />
      {/* Bottom square (colon) */}
      <rect fill="#555" height="9" width="9" x="0" y="24" />
      {/* Top square (colon) */}
      <rect fill="#555" height="9" width="9" x="0" y="12" />
      {/* T (horizontal bar) */}
      <rect fill="#999" height="9" width="33" x="0" y="0" />
      {/* T (vertical bar) */}
      <rect fill="#999" height="33" width="9" x="12" y="0" />
    </svg>
  );
}
