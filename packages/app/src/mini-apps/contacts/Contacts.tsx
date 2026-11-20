import { useWindowFileMenuItem, useWindowSidebar } from "@tearleads/windowing";
import { useEffect, useState } from "react";
import { CopyMyIdentityLinkButton } from "../../components/identity/CopyMyIdentityLinkButton";
import { IdentityLinkSignIn } from "../../components/identity/IdentityLinkSignIn";
import { MiniAppRoot } from "../../components/mini-app/MiniAppLayout";
import { isContactAddressRow } from "../../document-types/contact/contactAddressModel";
import { useRowWritersForDocument } from "../../stores/documents/useDocumentRowWriters";
import { SystemBootstrapGate } from "../SystemBootstrapGate";
import { ContactsContextMenuLayer } from "./context-menu/ContactsContextMenu";
import "./Contacts.css";
import { useContactsRoutedChromeActions } from "./ContactsRoutedChrome";
import { ContactsListHome } from "./ContactsSidebar";
import { ContactsDetailPanel } from "./detail/ContactsDetailPanel";
import { useContactsModel } from "./hooks/useContactsModel";
import { CONTACTS_LABELS } from "./labels";

export function Contacts() {
  return (
    <SystemBootstrapGate message="Setting up your contacts">
      <ContactsContent />
    </SystemBootstrapGate>
  );
}

function ContactsDetailRoute({
  model,
  initialEditing,
}: {
  initialEditing: boolean;
  model: ReturnType<typeof useContactsModel>;
}) {
  const selected = model.entries.find(
    (entry) => entry.id === model.selectedContactId,
  );
  const resolveAddressWriter = useRowWritersForDocument({
    documentId: selected?.documentId ?? null,
    enabled:
      model.route === "selection" &&
      selected?.rows?.some(isContactAddressRow) === true,
    syncing: selected?.syncing ?? false,
  });
  return (
    <ContactsDetailPanel
      initialEditing={initialEditing}
      addressActions={model.addressActions}
      resolveAddressWriter={resolveAddressWriter}
      getContactDocumentStore={model.getContactDocumentStore}
      canCreate={model.canCreate}
      canImport={model.canImport}
      createDraftContact={model.createDraftContact}
      currentSigningFingerprint={model.currentSigningFingerprint}
      currentUserId={model.currentUserId}
      draftFirstName={model.draftFirstName}
      draftLastName={model.draftLastName}
      draftNickname={model.draftNickname}
      draftUserId={model.draftUserId}
      entries={model.entries}
      importDraftContact={model.importDraftContact}
      importError={model.importError}
      isAuthenticated={model.isAuthenticated}
      signInAction={<IdentityLinkSignIn />}
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
  );
}

function ContactsContent() {
  const { setSidebar } = useWindowSidebar();
  const model = useContactsModel(setSidebar);
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const initialEditing =
    editContactId !== null && model.selectedContactId === editContactId;
  useEffect(() => {
    if (initialEditing) setEditContactId(null);
  }, [initialEditing]);
  useContactsRoutedChromeActions({
    canWrite: model.canWrite,
    openImportContactRoute: model.openImportContactRoute,
    openNewContactRoute: model.openNewContactRoute,
    ready: model.ready,
    route: model.route,
  });
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
      {/* Your own card offers the link too (ContactsDetailPanel); the phone
          list home keeps it within reach of the place people land. */}
      {model.showCompactListHome && <CopyMyIdentityLinkButton />}
      {model.showCompactListHome ? (
        <ContactsListHome
          blobStore={model.blobStore}
          currentSigningFingerprint={model.currentSigningFingerprint}
          currentUserId={model.currentUserId}
          entries={model.entries}
          handleAreaContextMenu={model.contextMenuState.handleAreaContextMenu}
          handleContextMenu={model.contextMenuState.handleSidebarContextMenu}
          ready={model.ready}
          selectedContactId={model.selectedContactId}
          setSelectedContactId={model.selectContact}
        />
      ) : (
        <ContactsDetailRoute model={model} initialEditing={initialEditing} />
      )}
      <ContactsContextMenuLayer
        {...model.contextMenuState}
        editContact={(id) => {
          setEditContactId(id);
          if (model.selectedContactId !== id) model.selectContact(id);
        }}
        openImportContactRoute={model.openImportContactRoute}
        openNewContactRoute={model.openNewContactRoute}
        ready={model.ready}
        canWrite={model.canWrite}
      />
    </MiniAppRoot>
  );
}
