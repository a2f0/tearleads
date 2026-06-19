import { useEffect, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppField,
  MiniAppFormPanel,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInput,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { ContactFields } from "../../../document-types/contact/ContactFields";
import type {
  ContactFieldKey,
  ContactFieldValues,
} from "../../../document-types/contact/contactFieldDescriptors";
import { CONTACTS_LABELS } from "../labels";
import type { ContactsRoute } from "../routes";
import type { ContactEntries, ContactEntryPatch } from "../types";
import {
  type ContactsAreaContextMenuHandler,
  ContactsDetailContextTarget,
} from "./ContactsDetailContextTarget";

type UpdateContact = (contactId: string, patch: ContactEntryPatch) => void;
type SelectedContactEntry = ContactEntries[number];

function toContactFieldValues(entry: SelectedContactEntry): ContactFieldValues {
  return {
    encapsulationPublicKey: entry.encapsulationPublicKey ?? "",
    firstName: entry.firstName,
    lastName: entry.lastName,
    nickname: entry.nickname,
    userId: entry.userId ?? "",
  };
}

function toContactEntryPatch(
  key: ContactFieldKey,
  value: string,
): ContactEntryPatch {
  return { [key]: value };
}

function ContactsSelectionState({
  entries,
  ready,
  selectedContactId,
  updateContact,
}: {
  entries: ContactEntries;
  ready: boolean;
  selectedContactId: string | null;
  updateContact: UpdateContact;
}) {
  const selectedEntry = entries.find((entry) => entry.id === selectedContactId);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const isEditing = editingContactId === selectedEntry?.id;

  useEffect(() => {
    setEditingContactId(null);
  }, [selectedEntry?.id]);

  if (!selectedEntry) {
    return (
      <MiniAppStatus>
        {ready && entries.length > 0
          ? CONTACTS_LABELS.selectState
          : !ready
            ? CONTACTS_LABELS.loadingState
            : CONTACTS_LABELS.emptyState}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppPanel key={selectedEntry.id} variant="framed">
      <MiniAppActions>
        <MiniAppButton
          onClick={() =>
            setEditingContactId(isEditing ? null : selectedEntry.id)
          }
        >
          {isEditing ? CONTACTS_LABELS.doneAction : CONTACTS_LABELS.editAction}
        </MiniAppButton>
      </MiniAppActions>
      <ContactFields
        isEditing={isEditing}
        onFieldCommit={(key, value) =>
          updateContact(selectedEntry.id, toContactEntryPatch(key, value))
        }
        values={toContactFieldValues(selectedEntry)}
      />
    </MiniAppPanel>
  );
}

function ContactsNewContactPanel(params: {
  canCreate: boolean;
  createDraftContact: () => Promise<void>;
  draftFirstName: string;
  draftLastName: string;
  draftNickname: string;
  onBackToSelectionRoute: () => void;
  setDraftFirstName: (firstName: string) => void;
  setDraftLastName: (lastName: string) => void;
  setDraftNickname: (nickname: string) => void;
}) {
  const {
    canCreate,
    createDraftContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    onBackToSelectionRoute,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
  } = params;

  return (
    <MiniAppFormPanel
      onSubmit={(event) => {
        event.preventDefault();
        void createDraftContact();
      }}
      variant="framed"
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{CONTACTS_LABELS.newContactAction}</strong>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton type="button" onClick={onBackToSelectionRoute}>
            {CONTACTS_LABELS.backToContactsAction}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <MiniAppField>
        <span>{CONTACTS_LABELS.nicknameField}</span>
        <MiniAppInput
          aria-label={CONTACTS_LABELS.nicknameField}
          value={draftNickname}
          onChange={(event) => setDraftNickname(event.target.value)}
        />
      </MiniAppField>
      <MiniAppField>
        <span>{CONTACTS_LABELS.firstNameField}</span>
        <MiniAppInput
          aria-label={CONTACTS_LABELS.firstNameField}
          value={draftFirstName}
          onChange={(event) => setDraftFirstName(event.target.value)}
        />
      </MiniAppField>
      <MiniAppField>
        <span>{CONTACTS_LABELS.lastNameField}</span>
        <MiniAppInput
          aria-label={CONTACTS_LABELS.lastNameField}
          value={draftLastName}
          onChange={(event) => setDraftLastName(event.target.value)}
        />
      </MiniAppField>
      <MiniAppActions>
        <MiniAppButton disabled={!canCreate} type="submit">
          {CONTACTS_LABELS.createContactAction}
        </MiniAppButton>
      </MiniAppActions>
    </MiniAppFormPanel>
  );
}

function ContactsImportContactPanel(params: {
  canImport: boolean;
  draftUserId: string;
  importDraftContact: () => Promise<void>;
  isAuthenticated: boolean;
  onBackToSelectionRoute: () => void;
  setDraftUserId: (userId: string) => void;
}) {
  const {
    canImport,
    draftUserId,
    importDraftContact,
    isAuthenticated,
    onBackToSelectionRoute,
    setDraftUserId,
  } = params;

  return (
    <MiniAppFormPanel
      onSubmit={(event) => {
        event.preventDefault();
        void importDraftContact();
      }}
      variant="framed"
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{CONTACTS_LABELS.importContactAction}</strong>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton type="button" onClick={onBackToSelectionRoute}>
            {CONTACTS_LABELS.backToContactsAction}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <MiniAppField>
        <span>{CONTACTS_LABELS.contactUserIdField}</span>
        <MiniAppInput
          aria-label={CONTACTS_LABELS.contactUserIdField}
          value={draftUserId}
          onChange={(event) => setDraftUserId(event.target.value)}
          placeholder={CONTACTS_LABELS.userIdPlaceholder}
        />
      </MiniAppField>
      {!isAuthenticated && (
        <MiniAppStatus>
          {CONTACTS_LABELS.unauthenticatedImportState}
        </MiniAppStatus>
      )}
      <MiniAppActions>
        <MiniAppButton disabled={!canImport} type="submit">
          {CONTACTS_LABELS.importContactSubmitAction}
        </MiniAppButton>
      </MiniAppActions>
    </MiniAppFormPanel>
  );
}

export function ContactsDetailPanel(params: {
  canCreate: boolean;
  canImport: boolean;
  createDraftContact: () => Promise<void>;
  draftFirstName: string;
  draftLastName: string;
  draftNickname: string;
  draftUserId: string;
  entries: ContactEntries;
  importDraftContact: () => Promise<void>;
  isAuthenticated: boolean;
  onAreaContextMenu: ContactsAreaContextMenuHandler;
  onBackToSelectionRoute: () => void;
  ready: boolean;
  route: ContactsRoute;
  selectedContactId: string | null;
  setDraftFirstName: (firstName: string) => void;
  setDraftLastName: (lastName: string) => void;
  setDraftNickname: (nickname: string) => void;
  setDraftUserId: (userId: string) => void;
  updateContact: UpdateContact;
}) {
  const {
    canCreate,
    canImport,
    createDraftContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    draftUserId,
    entries,
    importDraftContact,
    isAuthenticated,
    onAreaContextMenu,
    onBackToSelectionRoute,
    ready,
    route,
    selectedContactId,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
    setDraftUserId,
    updateContact,
  } = params;

  if (route === "new-contact") {
    return (
      <ContactsNewContactPanel
        canCreate={canCreate}
        createDraftContact={createDraftContact}
        draftFirstName={draftFirstName}
        draftLastName={draftLastName}
        draftNickname={draftNickname}
        onBackToSelectionRoute={onBackToSelectionRoute}
        setDraftFirstName={setDraftFirstName}
        setDraftLastName={setDraftLastName}
        setDraftNickname={setDraftNickname}
      />
    );
  }

  if (route === "import-contact") {
    return (
      <ContactsImportContactPanel
        canImport={canImport}
        draftUserId={draftUserId}
        importDraftContact={importDraftContact}
        isAuthenticated={isAuthenticated}
        onBackToSelectionRoute={onBackToSelectionRoute}
        setDraftUserId={setDraftUserId}
      />
    );
  }

  return (
    <ContactsDetailContextTarget onAreaContextMenu={onAreaContextMenu}>
      <ContactsSelectionState
        entries={entries}
        ready={ready}
        selectedContactId={selectedContactId}
        updateContact={updateContact}
      />
    </ContactsDetailContextTarget>
  );
}
