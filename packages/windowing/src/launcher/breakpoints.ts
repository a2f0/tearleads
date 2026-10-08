/** Windows need desktop width; narrower screens use the routed shell. */
export const WINDOWED_LAYOUT_MIN_WIDTH_PX = 1024;

export const WINDOWED_LAYOUT_NARROW_QUERY = `(max-width: ${WINDOWED_LAYOUT_MIN_WIDTH_PX - 1}px)`;

/**
 * Within the routed layout, the divider between the two responsive tiers:
 *
 * - Below this width the shell is a phone-style chrome: a top app bar, and a
 *   bottom sheet of launcher tiles.
 * - At or above it the shell is a tablet/iPad-style chrome with a launcher that
 *   can use a left rail or bottom sheet.
 *
 * Mirrors the `759px` media queries in the routed stylesheets; a test keeps the
 * two in sync.
 */
export const ROUTED_TABLET_BREAKPOINT_PX = 760;

/** Matches routed viewports wide enough for the persistent side-rail layout. */
export const ROUTED_TABLET_QUERY = `(min-width: ${ROUTED_TABLET_BREAKPOINT_PX}px)`;
