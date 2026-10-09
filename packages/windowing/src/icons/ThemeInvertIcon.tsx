import type { WindowingIconProps } from "./windowingIcon";

/**
 * The theme switch's glyph, the same mark as Tearleads' `ThemeInvertIcon`: a
 * square with one triangular half in `currentColor`. The other half shows the
 * surface beneath, so the mark inverts with the theme.
 */
export function ThemeInvertIcon({ size = 20, ...props }: WindowingIconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      height={size}
      viewBox="0 0 256 256"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect
        fill="none"
        height="168"
        stroke="currentColor"
        strokeWidth="16"
        width="168"
        x="44"
        y="44"
      />
      <path d="M212 44V212H44Z" fill="currentColor" />
    </svg>
  );
}
