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

/**
 * Within the routed layout, the divider between the two responsive tiers:
 *
 * - Below this width the shell is a phone-style chrome: a top app bar with a
 *   hamburger that opens a slide-in navigation drawer.
 * - At or above it the shell is a tablet/iPad-style chrome: a persistent left
 *   sidebar rail beside the main content.
 *
 * Mirrors the `760px` media query in `RoutedPane.css`; keep the two in sync.
 */
export const ROUTED_TABLET_BREAKPOINT_PX = 760;

/** Matches routed viewports wide enough for the persistent side-rail layout. */
export const ROUTED_TABLET_QUERY = `(min-width: ${ROUTED_TABLET_BREAKPOINT_PX}px)`;
