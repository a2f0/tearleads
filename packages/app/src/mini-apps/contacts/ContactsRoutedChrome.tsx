import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
import { useMemo } from "react";
import { useWindowTitleBarAction } from "../../components/window/WindowMenuContext";
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
  const showSelectionActions = route === "selection";
  const newContactAction = useMemo(
    () =>
      showSelectionActions
        ? {
            disabled: !ready || !canWrite,
            icon: <AddressBookIcon aria-hidden size={18} />,
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
            icon: <UserPlusIcon aria-hidden size={18} />,
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
