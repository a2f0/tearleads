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
