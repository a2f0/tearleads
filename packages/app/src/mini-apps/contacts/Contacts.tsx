import { MiniAppRoot } from "../../components/shared/MiniAppLayout";
import { useWindowFileMenuItem } from "../../components/window/WindowMenuContext";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { SystemBootstrapGate } from "../SystemBootstrapGate";
import { ContactsContextMenuLayer } from "./context-menu/ContactsContextMenu";
import { ContactsDetailPanel } from "./detail/ContactsDetailPanel";
import { useContactsModel } from "./hooks/useContactsModel";
import { CONTACTS_LABELS } from "./labels";

export function Contacts() {
  return (
    <SystemBootstrapGate message="Bootstrapping contacts...">
      <ContactsContent />
    </SystemBootstrapGate>
  );
}

function ContactsContent() {
  const { setSidebar } = useWindowSidebar();
  const model = useContactsModel(setSidebar);
  useWindowFileMenuItem({
    disabled: !model.ready || !model.canWrite,
    id: "contacts-new-contact",
    label: CONTACTS_LABELS.newContactAction,
    onClick: model.openNewContactRoute,
    priority: 100,
  });
  useWindowFileMenuItem({
    disabled: !model.ready || !model.canWrite,
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
        contextMenuContactUserId={
          model.contextMenuState.contextMenuContactUserId
        }
        contextMenu={model.contextMenuState.contextMenu}
        openImportContactRoute={model.openImportContactRoute}
        openNewContactRoute={model.openNewContactRoute}
        ready={model.ready}
        canWrite={model.canWrite}
        removeContextMenuContact={
          model.contextMenuState.removeContextMenuContact
        }
      />
    </MiniAppRoot>
  );
}
