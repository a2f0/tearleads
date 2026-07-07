import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
import { useEffect, useMemo, useState } from "react";
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
import {
  useWindowBackAction,
  useWindowTitleBarAction,
} from "../../../components/window/WindowMenuContext";
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
    nickname: entry.nickname ?? "",
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
  isRoutedShell,
  updateContact,
}: {
  entries: ContactEntries;
  isRoutedShell: boolean;
  ready: boolean;
  selectedContactId: string | null;
  updateContact: UpdateContact;
}) {
  const selectedEntry = entries.find((entry) => entry.id === selectedContactId);
  const selectedEntryId = selectedEntry?.id;
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const isEditing = editingContactId === selectedEntryId;
  const canEditSelectedEntry = ready && selectedEntry?.canWrite !== false;

  useEffect(() => {
    setEditingContactId(null);
  }, [selectedEntryId]);
  useEffect(() => {
    if (!canEditSelectedEntry) {
      setEditingContactId(null);
    }
  }, [canEditSelectedEntry]);
  const editAction = useMemo(() => {
    if (!isRoutedShell || selectedEntryId === undefined) {
      return null;
    }

    return {
      disabled: !canEditSelectedEntry,
      icon: isEditing ? (
        <CheckIcon aria-hidden size={18} />
      ) : (
        <PencilSimpleIcon aria-hidden size={18} />
      ),
      id: "contacts-toggle-edit",
      label: isEditing
        ? CONTACTS_LABELS.doneAction
        : CONTACTS_LABELS.editAction,
      onClick: () => {
        setEditingContactId(isEditing ? null : selectedEntryId);
      },
      priority: 100,
    };
  }, [canEditSelectedEntry, isEditing, isRoutedShell, selectedEntryId]);

  useWindowTitleBarAction(editAction);

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
    <MiniAppPanel key={selectedEntry.id}>
      {!isRoutedShell && (
        <MiniAppActions>
          <MiniAppButton
            disabled={!canEditSelectedEntry}
            onClick={() =>
              setEditingContactId(isEditing ? null : selectedEntry.id)
            }
          >
            {isEditing
              ? CONTACTS_LABELS.doneAction
              : CONTACTS_LABELS.editAction}
          </MiniAppButton>
        </MiniAppActions>
      )}
      <ContactFields
        disabled={!canEditSelectedEntry}
        isEditing={isEditing && canEditSelectedEntry}
        onFieldCommit={(key, value) => {
          if (canEditSelectedEntry) {
            updateContact(selectedEntry.id, toContactEntryPatch(key, value));
          }
        }}
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
  isRoutedShell: boolean;
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
    isRoutedShell,
    onBackToSelectionRoute,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
  } = params;
  const createAction = useMemo(
    () =>
      isRoutedShell
        ? {
            disabled: !canCreate,
            icon: <CheckIcon aria-hidden size={18} />,
            id: "contacts-create-contact",
            label: CONTACTS_LABELS.createContactAction,
            onClick: createDraftContact,
            priority: 100,
          }
        : null,
    [canCreate, createDraftContact, isRoutedShell],
  );

  useWindowTitleBarAction(createAction);

  return (
    <MiniAppFormPanel
      onSubmit={(event) => {
        event.preventDefault();
        void createDraftContact();
      }}
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{CONTACTS_LABELS.newContactAction}</strong>
        </MiniAppHeaderCopy>
        {!isRoutedShell && (
          <MiniAppActions>
            <MiniAppButton type="button" onClick={onBackToSelectionRoute}>
              {CONTACTS_LABELS.backToContactsAction}
            </MiniAppButton>
          </MiniAppActions>
        )}
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
      {!isRoutedShell && (
        <MiniAppActions>
          <MiniAppButton disabled={!canCreate} type="submit">
            {CONTACTS_LABELS.createContactAction}
          </MiniAppButton>
        </MiniAppActions>
      )}
    </MiniAppFormPanel>
  );
}

function ContactsImportContactPanel(params: {
  canImport: boolean;
  draftUserId: string;
  importDraftContact: () => Promise<void>;
  isAuthenticated: boolean;
  isRoutedShell: boolean;
  onBackToSelectionRoute: () => void;
  setDraftUserId: (userId: string) => void;
}) {
  const {
    canImport,
    draftUserId,
    importDraftContact,
    isAuthenticated,
    isRoutedShell,
    onBackToSelectionRoute,
    setDraftUserId,
  } = params;
  const importAction = useMemo(
    () =>
      isRoutedShell
        ? {
            disabled: !canImport,
            icon: <UserPlusIcon aria-hidden size={18} />,
            id: "contacts-import-contact-submit",
            label: CONTACTS_LABELS.importContactSubmitAction,
            onClick: importDraftContact,
            priority: 100,
          }
        : null,
    [canImport, importDraftContact, isRoutedShell],
  );

  useWindowTitleBarAction(importAction);

  return (
    <MiniAppFormPanel
      onSubmit={(event) => {
        event.preventDefault();
        void importDraftContact();
      }}
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{CONTACTS_LABELS.importContactAction}</strong>
        </MiniAppHeaderCopy>
        {!isRoutedShell && (
          <MiniAppActions>
            <MiniAppButton type="button" onClick={onBackToSelectionRoute}>
              {CONTACTS_LABELS.backToContactsAction}
            </MiniAppButton>
          </MiniAppActions>
        )}
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
      {!isRoutedShell && (
        <MiniAppActions>
          <MiniAppButton disabled={!canImport} type="submit">
            {CONTACTS_LABELS.importContactSubmitAction}
          </MiniAppButton>
        </MiniAppActions>
      )}
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
  isRoutedShell?: boolean | undefined;
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
    isRoutedShell = false,
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
  const backAction = useMemo(
    () =>
      isRoutedShell && route !== "selection"
        ? {
            label: CONTACTS_LABELS.backToContactsAction,
            onClick: onBackToSelectionRoute,
            priority: 100,
          }
        : null,
    [isRoutedShell, onBackToSelectionRoute, route],
  );

  useWindowBackAction(backAction);

  if (route === "new-contact") {
    return (
      <ContactsNewContactPanel
        canCreate={canCreate}
        createDraftContact={createDraftContact}
        draftFirstName={draftFirstName}
        draftLastName={draftLastName}
        draftNickname={draftNickname}
        isRoutedShell={isRoutedShell}
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
        isRoutedShell={isRoutedShell}
        onBackToSelectionRoute={onBackToSelectionRoute}
        setDraftUserId={setDraftUserId}
      />
    );
  }

  return (
    <ContactsDetailContextTarget onAreaContextMenu={onAreaContextMenu}>
      <ContactsSelectionState
        entries={entries}
        isRoutedShell={isRoutedShell}
        ready={ready}
        selectedContactId={selectedContactId}
        updateContact={updateContact}
      />
    </ContactsDetailContextTarget>
  );
}
