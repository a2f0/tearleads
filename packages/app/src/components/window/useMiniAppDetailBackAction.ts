import { useWindowBackAction } from "./WindowMenuContext";

interface MiniAppDetailBackAction {
  disabled?: boolean | undefined;
  label: string;
  onBack: () => void;
  priority?: number | undefined;
}

/**
 * Registers a mini-app's detail-level "Back" affordance into the shared toolbar
 * back slot. The single registration surfaces in BOTH chrome surfaces that read
 * {@link useWindowBackAction}: the windowed {@link WindowToolBar} (as the left
 * "Back" button) and the compact/tablet `RoutedPaneAppBar` (where it overrides
 * that bar's app-history back caret). Pass `null` when the detail is closed so no
 * back action is registered.
 *
 * This is the named, first-class "mini-app detail back" concept. It is a thin
 * wrapper over the generic window-chrome primitive; the value is the shared
 * convention plus this rule on WHEN a mini-app should register:
 *
 * - Route-backed detail (selection lives in `useMiniAppRouteSegments`, e.g. a URL
 *   path segment): the compact/tablet `RoutedPaneAppBar` already gives working
 *   back AND forward for free via browser history, so only register in WINDOWED
 *   mode — where the toolbar has no history caret. Registering in a routed tier
 *   would replace the history pop with a route push and truncate forward.
 * - Non-routed detail (selection is internal component state, so app-history back
 *   cannot restore it): register whenever the detail is open, in EVERY mode.
 *
 * Keep `onBack` reference-stable (e.g. `useCallback`) so the toolbar does not
 * re-register on every render.
 */
export function useMiniAppDetailBackAction(
  action: MiniAppDetailBackAction | null,
): void {
  useWindowBackAction(
    action
      ? {
          disabled: action.disabled ?? false,
          label: action.label,
          onClick: action.onBack,
          priority: action.priority ?? 100,
        }
      : null,
  );
}
