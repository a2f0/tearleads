/**
 * Decides whether a mini-app's chrome should register its own detail "Back"
 * action, or stand aside and let the host's Back affordance handle it.
 *
 * A **route-backed** detail surface keeps its state in the route (Explorer's
 * document info, org-manager's group and grant detail, a contact's detail), so
 * navigating into it already left a history entry behind. Where the host offers
 * a real Back, that entry is what Back should pop. A registered back action
 * replaces the pop with a route PUSH of the parent, and the pair then never
 * unwinds: "Get Info" -> Back pushes the document, the document registers no
 * override so Back pops to "Get Info", and the two alternate forever instead of
 * reaching the list. (Reported on mobile as: open a document, Get Info, then
 * Back just toggles between the two panes and never returns to the Explorer
 * list.)
 *
 * So the chrome owns Back only when there is no history entry to pop — a deep
 * link or a freshly opened window sitting on its first route, where the host's
 * caret is dead and this route-derived fallback is the only way out.
 *
 * **This is deliberately not a question about navigation mode.** It used to be:
 * windowed chrome had no history of any kind, so "windowed" was a sound proxy
 * for "nothing to pop". Windows now carry their own Back stack
 * (`WindowEntry.miniAppRouteHistory`), so that proxy would put the alternating
 * loop into windowed mode. Ask the host whether it can go back —
 * `useMiniAppRouteSegments().canGoBack` answers for both shells — and never
 * branch on the mode here.
 *
 * Detail state that is NOT route-backed is the other case, and must register in
 * every mode, because no Back stack can restore it: org-manager's roster
 * selection and the blob browser's drill-in are internal component state, so
 * they register unconditionally (and outrank a route-level action by priority).
 */
export function chromeOwnsRouteBackedDetailBack({
  historyCanGoBack,
}: {
  historyCanGoBack: boolean;
}): boolean {
  return !historyCanGoBack;
}
