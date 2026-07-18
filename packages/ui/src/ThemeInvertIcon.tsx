import type { SVGProps } from "react";

export interface ThemeInvertIconProps extends SVGProps<SVGSVGElement> {
  readonly size?: number;
}

/**
 * Theme-neutral invert glyph shared by every surface that switches between
 * light and dark. One triangular half uses `currentColor`; the transparent
 * half shows the control surface beneath it, so the mark naturally inverts
 * with the active theme.
 */
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
