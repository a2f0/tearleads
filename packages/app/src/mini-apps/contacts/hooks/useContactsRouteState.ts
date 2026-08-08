import { useCallback, useEffect, useRef, useState } from "react";
import { useMiniAppRouteState } from "../../../navigation/useMiniAppRouteState";
import {
  type ContactsRouteSnapshot,
  createContactsSelectionRouteSnapshot,
  DEFAULT_CONTACTS_ROUTE_SNAPSHOT,
  formatContactsRouteSegments,
  parseContactsRouteSegments,
} from "../routes";

export function useContactsRouteState(compactRoutedMode: boolean) {
  const [localRoute, setLocalRoute] = useState<ContactsRouteSnapshot>(
    DEFAULT_CONTACTS_ROUTE_SNAPSHOT,
  );
  const { route: routeSnapshot, setRoute: setRouteSnapshot } =
    useMiniAppRouteState({
      appId: "contacts",
      formatRouteSegments: formatContactsRouteSegments,
      localRoute,
      parseRouteSegments: parseContactsRouteSegments,
      setLocalRoute,
    });
  const showSelectionRoute = useCallback(
    (options: { replace?: boolean | undefined } = {}) =>
      setRouteSnapshot(
        createContactsSelectionRouteSnapshot(
          compactRoutedMode,
          routeSnapshot.selectedContactId,
        ),
        options,
      ),
    [compactRoutedMode, routeSnapshot.selectedContactId, setRouteSnapshot],
  );
  const openNewContactRoute = useCallback(
    () => setRouteSnapshot({ route: "new-contact", selectedContactId: null }),
    [setRouteSnapshot],
  );
  const openImportContactRoute = useCallback(
    () =>
      setRouteSnapshot({ route: "import-contact", selectedContactId: null }),
    [setRouteSnapshot],
  );
  const selectContactRoute = useCallback(
    (contactId: string, options: { replace?: boolean | undefined } = {}) =>
      setRouteSnapshot(
        { route: "selection", selectedContactId: contactId },
        options,
      ),
    [setRouteSnapshot],
  );
  // The live route, for callbacks that resolve after a later render. Creating
  // and importing both await storage, and the File menu keeps both draft
  // actions reachable throughout, so the user can route away — to a contact or
  // to the other draft form — before the write lands.
  const currentRouteRef = useRef(routeSnapshot.route);
  useEffect(() => {
    currentRouteRef.current = routeSnapshot.route;
  }, [routeSnapshot.route]);
  // Lands on a contact that was just created or imported. new-contact and
  // import-contact are transient draft routes, so replace them instead of
  // pushing: navigating back from the saved contact should return to wherever
  // the draft was started from, not re-open the blank form. A message-driven
  // import (org-manager's "Import Into Contacts") arrives on the selection
  // route, which has nothing transient to prune and still pushes.
  //
  // Only the draft entry that started this save may be pruned, so replace only
  // while that same entry is still current. A save that lands after the user
  // moved on pushes instead — replacing then would delete whatever they moved
  // to and leave the draft in history regardless.
  const initiatingRoute = routeSnapshot.route;
  const selectCreatedContactRoute = useCallback(
    (contactId: string) =>
      selectContactRoute(contactId, {
        replace:
          initiatingRoute !== "selection" &&
          currentRouteRef.current === initiatingRoute,
      }),
    [initiatingRoute, selectContactRoute],
  );

  return {
    openImportContactRoute,
    openNewContactRoute,
    route: routeSnapshot.route,
    selectContactRoute,
    selectCreatedContactRoute,
    selectedContactId: routeSnapshot.selectedContactId,
    showSelectionRoute,
  };
}
