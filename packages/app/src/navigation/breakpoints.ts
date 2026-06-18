/**
 * Single source of truth for the windowed/routed navigation breakpoint.
 *
 * Below {@link MOBILE_BREAKPOINT_PX} (or on coarse-pointer / iPad-like
 * devices) the app uses the single-pane `routed` layout; at or above it the
 * desktop `windowed` window-manager layout is used.
 */
export const MOBILE_BREAKPOINT_PX = 1024;

/** Matches viewports that should use the routed layout (width < breakpoint). */
export const MOBILE_BREAKPOINT_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`;

/** Matches touch-first pointers, which always use the routed layout. */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";
