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
        canImport={model.canImport}
        draftUserId={model.draftUserId}
        entries={model.entries}
        importDraftContact={model.importDraftContact}
        isAuthenticated={model.isAuthenticated}
        ready={model.ready}
        selectedUserId={model.selectedUserId}
        setDraftUserId={model.setDraftUserId}
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
