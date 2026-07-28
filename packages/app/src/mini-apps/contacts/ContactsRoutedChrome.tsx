import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { useMemo } from "react";
import {
  useWindowTitleBarAction,
  useWindowToolbarReservation,
} from "../../components/window/WindowMenuContext";
import { NewContactIcon } from "../shared/newContactIcon";
import { CONTACTS_LABELS } from "./labels";
import type { ContactsRoute } from "./routes";

export function useContactsRoutedChromeActions({
  canWrite,
  openImportContactRoute,
  openNewContactRoute,
  ready,
  route,
}: {
  canWrite: boolean;
  openImportContactRoute: () => void;
  openNewContactRoute: () => void;
  ready: boolean;
  route: ContactsRoute;
}) {
  // Reserve the toolbar row on every contacts route so the bar holds a stable
  // height instead of collapsing when a non-selection route (new-contact or
  // import-contact, which register no toolbar actions) is shown. Matches notes
  // and org-manager; keeps a blank bar the same height as a filled one
  // (WindowToolBar.css). The chrome hook only runs past SystemBootstrapGate, so
  // there is no pre-auth state to guard as org-manager has.
  useWindowToolbarReservation();

  const showSelectionActions = route === "selection";
  const newContactAction = useMemo(
    () =>
      showSelectionActions
        ? {
            disabled: !ready || !canWrite,
            icon: <NewContactIcon aria-hidden size={18} />,
            id: "contacts-new-contact-toolbar",
            label: CONTACTS_LABELS.newContactAction,
            onClick: openNewContactRoute,
            priority: 200,
          }
        : null,
    [canWrite, openNewContactRoute, ready, showSelectionActions],
  );
  const importContactAction = useMemo(
    () =>
      showSelectionActions
        ? {
            disabled: !ready || !canWrite,
            icon: <AddressBookIcon aria-hidden size={18} />,
            id: "contacts-import-contact-toolbar",
            label: CONTACTS_LABELS.importContactAction,
            onClick: openImportContactRoute,
            priority: 100,
          }
        : null,
    [canWrite, openImportContactRoute, ready, showSelectionActions],
  );

  useWindowTitleBarAction(newContactAction);
  useWindowTitleBarAction(importContactAction);
}
