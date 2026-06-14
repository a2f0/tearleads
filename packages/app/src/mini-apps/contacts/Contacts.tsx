import { usePeerUserId } from "../../components/pane/DualPaneProvider";
import { MiniAppRoot } from "../../components/shared/MiniAppLayout";
import { useWindowFileMenuItem } from "../../components/window/WindowMenuContext";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { ContactsContextMenuLayer } from "./context-menu/ContactsContextMenu";
import { ContactsDetailPanel } from "./detail/ContactsDetailPanel";
import { useContactsModel } from "./hooks/useContactsModel";
import { CONTACTS_LABELS } from "./labels";

export function Contacts() {
  const { setSidebar } = useWindowSidebar();
  const peerUserId = usePeerUserId();
  const model = useContactsModel(setSidebar, peerUserId);
  useWindowFileMenuItem({
    disabled: !model.ready,
    id: "contacts-new-contact",
    label: CONTACTS_LABELS.newContactAction,
    onClick: model.openNewContactRoute,
    priority: 100,
  });
  useWindowFileMenuItem({
    disabled: !model.ready,
    id: "contacts-import-contact",
    label: CONTACTS_LABELS.importContactAction,
    onClick: model.openImportContactRoute,
    priority: 90,
  });

  return (
    <MiniAppRoot className="contacts">
      <ContactsDetailPanel
        canCreate={model.canCreate}
        canImport={model.canImport}
        createDraftContact={model.createDraftContact}
        draftFirstName={model.draftFirstName}
        draftLastName={model.draftLastName}
        draftNickname={model.draftNickname}
        draftUserId={model.draftUserId}
        entries={model.entries}
        importDraftContact={model.importDraftContact}
        isAuthenticated={model.isAuthenticated}
        onAreaContextMenu={model.contextMenuState.handleAreaContextMenu}
        onBackToSelectionRoute={model.showSelectionRoute}
        ready={model.ready}
        route={model.route}
        selectedContactId={model.selectedContactId}
        setDraftFirstName={model.setDraftFirstName}
        setDraftLastName={model.setDraftLastName}
        setDraftNickname={model.setDraftNickname}
        setDraftUserId={model.setDraftUserId}
        updateContact={(contactId, patch) => {
          void model.updateContact(contactId, patch);
        }}
      />
      <ContactsContextMenuLayer
        canRemoveContextMenuContact={
          model.contextMenuState.canRemoveContextMenuContact
        }
        closeContextMenu={model.contextMenuState.closeContextMenu}
        contextMenu={model.contextMenuState.contextMenu}
        openImportContactRoute={model.openImportContactRoute}
        openNewContactRoute={model.openNewContactRoute}
        ready={model.ready}
        removeContextMenuContact={
          model.contextMenuState.removeContextMenuContact
        }
      />
    </MiniAppRoot>
  );
}
