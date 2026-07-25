import type { AppNavigationMode } from "../../navigation/AppNavigationMode";

/**
 * Decides whether Explorer's chrome should register its own detail "Back"
 * action, or stand aside and let the routed app bar's history caret handle it.
 *
 * Every Explorer detail view that offers Back — document info, the sync-lane and
 * write-queue entries, the diagnostics hub tabs, the blob browser — is
 * route-backed: its state lives in the URL path, so it already has a real app
 * history entry. In a routed tier the app bar's caret pops that entry, which
 * unwinds correctly and keeps Forward intact. A registered back action replaces
 * that pop with a route PUSH of the parent, and the pair then never unwinds:
 * "Get Info" -> Back pushes the document, the document registers no override so
 * Back pops to "Get Info", and the two alternate forever instead of reaching the
 * container. (Reported on mobile as: open a document, Get Info, then Back just
 * toggles between the two panes and never returns to the Explorer list.)
 *
 * So the chrome owns Back only where there is no history entry to pop:
 *
 * - WINDOWED mode, where the toolbar has no history caret at all.
 * - A routed deep link that starts the history stack (`historyCanGoBack` is
 *   false), where the caret would be dead and the route-derived fallback is the
 *   only way out.
 *
 * Selection that is NOT route-backed (internal component state, which
 * app-history back cannot restore) is the other case, and should register in
 * every mode — see `resolveOrgManagerDetailBackVisibility` for that side.
 */
export function explorerChromeOwnsDetailBack({
  historyCanGoBack,
  navigationMode,
}: {
  historyCanGoBack: boolean;
  navigationMode: AppNavigationMode;
}): boolean {
  return navigationMode === "windowed" || !historyCanGoBack;
}
