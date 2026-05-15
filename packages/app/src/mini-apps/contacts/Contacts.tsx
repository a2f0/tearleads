import { usePeerUserId } from "../../components/pane/DualPaneProvider";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { ContactsContextMenuLayer } from "./context-menu/ContactsContextMenu";
import { ContactsDetailPanel } from "./detail/ContactsDetailPanel";
import { useContactsModel } from "./hooks/useContactsModel";
import "./Contacts.css";

export function Contacts() {
  const { setSidebar } = useWindowSidebar();
  const peerUserId = usePeerUserId();
  const model = useContactsModel(setSidebar, peerUserId);

  return (
    <div className="contacts">
      <ContactsDetailPanel
        canCreate={model.canCreate}
        canImport={model.canImport}
        createDraftContact={model.createDraftContact}
        draftFirstName={model.draftFirstName}
        draftLastName={model.draftLastName}
        draftUserId={model.draftUserId}
        entries={model.entries}
        importDraftContact={model.importDraftContact}
        isAuthenticated={model.isAuthenticated}
        ready={model.ready}
        selectedContactId={model.selectedContactId}
        setDraftFirstName={model.setDraftFirstName}
        setDraftLastName={model.setDraftLastName}
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
        removeContextMenuContact={
          model.contextMenuState.removeContextMenuContact
        }
      />
    </div>
  );
}
