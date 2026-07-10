import type { SVGProps } from "react";

interface ThemeInvertIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

// A square split along its diagonal: one half painted with the current color,
// the other left transparent so the surface behind shows through. Because it
// paints with currentColor over a transparent ground, the two halves swap tone
// between the light and dark themes — a "photo negative" invert that mirrors
// what the toggle does. Uses the 256-unit viewBox and currentColor fill
// convention shared with the @phosphor-icons set used elsewhere in the footer.
export function ThemeInvertIcon({ size = 20, ...props }: ThemeInvertIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect
        x="44"
        y="44"
        width="168"
        height="168"
        fill="none"
        stroke="currentColor"
        strokeWidth="16"
      />
      <path d="M212 44V212H44Z" fill="currentColor" />
    </svg>
  );
}
