import type { AppNavigationMode } from "../../navigation/AppNavigationMode";
import type { OrgManagerView } from "./routes";

interface OrgManagerDetailBackVisibility {
  showGrantDetailBackAction: boolean;
  showGroupDetailBackAction: boolean;
  showRosterDetailBackAction: boolean;
}

/**
 * Decides which org-manager detail "Back" toolbar action is active for the
 * current view + selection + navigation mode. At most one is ever true (each is
 * keyed to its own view).
 *
 * Roster selection is internal component state (not in the route), so
 * app-history back cannot restore the roster list — surface the toolbar back in
 * EVERY mode. Group and grant selection live in the route, so the compact/tablet
 * routed app bar already gives history back/forward for free; only surface a
 * registered back action in WINDOWED mode, where the toolbar has no history
 * caret. Registering group/grant back in a routed tier would turn the app bar's
 * history pop into a route push and truncate forward — the regression that would
 * break the working mobile/tablet back behavior.
 */
export function resolveOrgManagerDetailBackVisibility({
  hasSelectedGrant,
  hasSelectedGroup,
  hasSelectedUser,
  mode,
  view,
}: {
  hasSelectedGrant: boolean;
  hasSelectedGroup: boolean;
  hasSelectedUser: boolean;
  mode: AppNavigationMode;
  view: OrgManagerView;
}): OrgManagerDetailBackVisibility {
  const windowed = mode === "windowed";
  return {
    showRosterDetailBackAction: view === "directory" && hasSelectedUser,
    showGroupDetailBackAction:
      windowed && view === "groups" && hasSelectedGroup,
    showGrantDetailBackAction:
      windowed && view === "grants" && hasSelectedGrant,
  };
}
