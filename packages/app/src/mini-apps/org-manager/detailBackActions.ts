import { chromeOwnsRouteBackedDetailBack } from "../../navigation/routeBackedDetailBack";
import type { OrgManagerView } from "./routes";

interface OrgManagerDetailBackVisibility {
  showGrantDetailBackAction: boolean;
  showGroupDetailBackAction: boolean;
  showRosterDetailBackAction: boolean;
}

/**
 * Decides which org-manager detail "Back" toolbar action is active for the
 * current view + selection + host history. At most one is ever true (each is
 * keyed to its own view).
 *
 * Roster selection is internal component state (not in the route), so
 * app-history back cannot restore the roster list — surface the toolbar back in
 * EVERY mode. Group and grant selection live in the route, so they follow
 * {@link chromeOwnsRouteBackedDetailBack}: register only where the host has no
 * history entry to pop. Registering one where it does turns the host's history
 * pop into a route push, and Back then alternates between the detail and its
 * list forever instead of unwinding.
 */
export function resolveOrgManagerDetailBackVisibility({
  hasSelectedGrant,
  hasSelectedGroup,
  hasSelectedUser,
  historyCanGoBack,
  view,
}: {
  hasSelectedGrant: boolean;
  hasSelectedGroup: boolean;
  hasSelectedUser: boolean;
  historyCanGoBack: boolean;
  view: OrgManagerView;
}): OrgManagerDetailBackVisibility {
  const ownsRouteBackedBack = chromeOwnsRouteBackedDetailBack({
    historyCanGoBack,
  });
  return {
    showRosterDetailBackAction: view === "directory" && hasSelectedUser,
    showGroupDetailBackAction:
      ownsRouteBackedBack && view === "groups" && hasSelectedGroup,
    showGrantDetailBackAction:
      ownsRouteBackedBack && view === "grants" && hasSelectedGrant,
  };
}
