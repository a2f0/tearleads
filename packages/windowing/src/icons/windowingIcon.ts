import type { ComponentType } from "react";

/**
 * The props the window chrome renders an icon with. Phosphor and Lucide icons
 * accept them, as does any component that draws an SVG from them.
 */
export interface WindowingIconProps {
  "aria-hidden"?: boolean | "true" | "false";
  className?: string;
  focusable?: boolean | "true" | "false";
  size?: number | string;
}

/** An icon from any icon set, as a component the chrome renders. */
export type WindowingIcon = ComponentType<WindowingIconProps>;
