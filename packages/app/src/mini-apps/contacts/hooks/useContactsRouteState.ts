import { useCallback, useState } from "react";
import { useMiniAppRouteSegments } from "../../../navigation/AppNavigationProvider";
import {
  type ContactsRouteSnapshot,
  createContactsSelectionRouteSnapshot,
  DEFAULT_CONTACTS_ROUTE_SNAPSHOT,
  formatContactsRouteSegments,
  parseContactsRouteSegments,
} from "../routes";

export function useContactsRouteState(compactRoutedMode: boolean) {
  const { isRouted, pathSegments, setPathSegments } =
    useMiniAppRouteSegments("contacts");
  const [localRoute, setLocalRoute] = useState<ContactsRouteSnapshot>(
    DEFAULT_CONTACTS_ROUTE_SNAPSHOT,
  );
  const routeSnapshot = isRouted
    ? parseContactsRouteSegments(pathSegments)
    : localRoute;
  const setRouteSnapshot = useCallback(
    (
      nextRoute: ContactsRouteSnapshot,
      options: { replace?: boolean | undefined } = {},
    ) => {
      if (isRouted) {
        setPathSegments(formatContactsRouteSegments(nextRoute), options);
        return;
      }
      setLocalRoute(nextRoute);
    },
    [isRouted, setPathSegments],
  );
  const showSelectionRoute = useCallback(
    () =>
      setRouteSnapshot(
        createContactsSelectionRouteSnapshot(
          compactRoutedMode,
          routeSnapshot.selectedContactId,
        ),
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
  // Lands on a contact that was just created or imported. new-contact and
  // import-contact are transient draft routes, so replace them instead of
  // pushing: navigating back from the saved contact should return to wherever
  // the draft was started from, not re-open the blank form. A message-driven
  // import (org-manager's "Import Into Contacts") arrives on the selection
  // route, which has nothing transient to prune and still pushes.
  const selectCreatedContactRoute = useCallback(
    (contactId: string) =>
      selectContactRoute(contactId, {
        replace: routeSnapshot.route !== "selection",
      }),
    [routeSnapshot.route, selectContactRoute],
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
