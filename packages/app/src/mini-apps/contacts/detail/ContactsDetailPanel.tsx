import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import type {
  BlobStore,
  DocumentAttachmentUpload,
} from "@tearleads/client-sdk";
import {
  useMiniAppRouteSegments,
  useWindowTitleBarAction,
} from "@tearleads/windowing";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AccountBootstrapLoadingPanel } from "../../../components/identity/AccountBootstrapLoadingPanel";
import { CopyMyIdentityLinkButton } from "../../../components/identity/CopyMyIdentityLinkButton";
import {
  MiniAppField,
  MiniAppFormPanel,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInput,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { useMiniAppDetailBackAction } from "../../../components/mini-app/useMiniAppDetailBackAction";
import { ContactAddresses } from "../../../document-types/contact/ContactAddresses";
import { ContactFields } from "../../../document-types/contact/ContactFields";
import type {
  ContactFieldKey,
  ContactFieldValues,
} from "../../../document-types/contact/contactFieldDescriptors";
import { chromeOwnsRouteBackedDetailBack } from "../../../navigation/routeBackedDetailBack";
import type { RowWriterResolver } from "../../../stores/documents/useDocumentRowWriters";
import { CONTACTS_LABELS } from "../labels";
import type { ContactsRoute } from "../routes";
import type {
  ContactAddressActions,
  ContactEntries,
  ContactEntryPatch,
} from "../types";
import { ContactsAvatarSection } from "./ContactsAvatarSection";
import {
  type ContactsAreaContextMenuHandler,
  ContactsDetailContextTarget,
} from "./ContactsDetailContextTarget";
import { ContactsImportContactPanel } from "./ContactsImportContactPanel";

type UpdateContact = (contactId: string, patch: ContactEntryPatch) => void;
type RemoveContactAvatar = (contactId: string) => void;
type SetContactAvatar = (
  contactId: string,
  upload: DocumentAttachmentUpload,
) => void;
type SelectedContactEntry = ContactEntries[number];

function toContactFieldValues(entry: SelectedContactEntry): ContactFieldValues {
  return {
    firstName: entry.firstName,
    lastName: entry.lastName,
    nickname: entry.nickname ?? "",
  };
}

function toContactEntryPatch(
  key: ContactFieldKey,
  value: string,
): ContactEntryPatch {
  return { [key]: value };
}

function ContactsSelectionState({
  addressActions,
  resolveAddressWriter,
  blobStore,
  currentSigningFingerprint,
  currentUserId,
  entries,
  ready,
  removeContactAvatar,
  selectedContactId,
  setContactAvatar,
  updateContact,
}: {
  blobStore: BlobStore;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  entries: ContactEntries;
  ready: boolean;
  removeContactAvatar: RemoveContactAvatar;
  selectedContactId: string | null;
  setContactAvatar: SetContactAvatar;
  updateContact: UpdateContact;
  addressActions: ContactAddressActions;
  resolveAddressWriter?: RowWriterResolver | undefined;
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
    if (selectedEntry?.canWrite === false) {
      setEditingContactId(null);
    }
  }, [selectedEntry?.canWrite]);
  const editAction = useMemo(() => {
    if (selectedEntryId === undefined) {
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
  }, [canEditSelectedEntry, isEditing, selectedEntryId]);

  useWindowTitleBarAction(editAction);

  if (!selectedEntry) {
    if (!ready) {
      return (
        <AccountBootstrapLoadingPanel title={CONTACTS_LABELS.loadingState} />
      );
    }

    return (
      <MiniAppStatus>
        {entries.length > 0
          ? CONTACTS_LABELS.selectState
          : CONTACTS_LABELS.emptyState}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppPanel className="contacts-detail-panel" key={selectedEntry.id}>
      <ContactsAvatarSection
        blobStore={blobStore}
        canEdit={isEditing && canEditSelectedEntry}
        currentSigningFingerprint={currentSigningFingerprint}
        currentUserId={currentUserId}
        entry={selectedEntry}
        removeContactAvatar={removeContactAvatar}
        setContactAvatar={setContactAvatar}
      />
      <ContactFields
        disabled={!canEditSelectedEntry}
        isEditing={isEditing && selectedEntry.canWrite !== false}
        onFieldCommit={(key, value) => {
          if (canEditSelectedEntry) {
            updateContact(selectedEntry.id, toContactEntryPatch(key, value));
          }
        }}
        values={toContactFieldValues(selectedEntry)}
      />
      <ContactAddresses
        key={JSON.stringify([
          currentUserId,
          currentSigningFingerprint,
          selectedEntry.id,
        ])}
        currentAuthorId={currentUserId ?? null}
        disabled={!canEditSelectedEntry}
        isEditing={isEditing && selectedEntry.canWrite !== false}
        rows={selectedEntry.rows}
        resolveRowWriter={resolveAddressWriter}
        onAddAddress={(fields) =>
          addressActions.addContactAddress(selectedEntry.id, fields)
        }
        onUpdateAddress={(id, patch) =>
          addressActions.updateContactAddress(selectedEntry.id, id, patch)
        }
        onRemoveAddress={(id) =>
          addressActions.removeContactAddress(selectedEntry.id, id)
        }
      />
      {selectedEntry.isSelf && <CopyMyIdentityLinkButton />}
    </MiniAppPanel>
  );
}

function ContactsNewContactPanel(params: {
  canCreate: boolean;
  createDraftContact: () => Promise<void>;
  draftFirstName: string;
  draftLastName: string;
  draftNickname: string;
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
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
  } = params;
  const createAction = useMemo(
    () => ({
      disabled: !canCreate,
      icon: <CheckIcon aria-hidden size={18} />,
      id: "contacts-create-contact",
      label: CONTACTS_LABELS.createContactAction,
      onClick: createDraftContact,
      priority: 100,
    }),
    [canCreate, createDraftContact],
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
    </MiniAppFormPanel>
  );
}

export function ContactsDetailPanel(params: {
  blobStore: BlobStore;
  canCreate: boolean;
  canImport: boolean;
  createDraftContact: () => Promise<void>;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  draftFirstName: string;
  draftLastName: string;
  draftNickname: string;
  draftUserId: string;
  entries: ContactEntries;
  importDraftContact: () => Promise<void>;
  importError?: string | null | undefined;
  signInAction?: ReactNode;
  isAuthenticated: boolean;
  onAreaContextMenu: ContactsAreaContextMenuHandler;
  onBackToSelectionRoute: (options?: { replace?: boolean | undefined }) => void;
  ready: boolean;
  removeContactAvatar: RemoveContactAvatar;
  route: ContactsRoute;
  selectedContactId: string | null;
  setContactAvatar: SetContactAvatar;
  setDraftFirstName: (firstName: string) => void;
  setDraftLastName: (lastName: string) => void;
  setDraftNickname: (nickname: string) => void;
  setDraftUserId: (userId: string) => void;
  updateContact: UpdateContact;
  addressActions: ContactAddressActions;
  resolveAddressWriter?: RowWriterResolver | undefined;
}) {
  const {
    blobStore,
    canCreate,
    canImport,
    createDraftContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    draftUserId,
    entries,
    importDraftContact,
    importError,
    isAuthenticated,
    onAreaContextMenu,
    onBackToSelectionRoute,
    route,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
    setDraftUserId,
    updateContact,
  } = params;
  // Every non-selection contacts route lives in the route, so this registration
  // must yield wherever the host has a real Back — otherwise its push turns the
  // host's pop into a second entry and Back alternates between the detail and
  // the list forever. See chromeOwnsRouteBackedDetailBack. What remains is the
  // no-history fallback, which replaces the dead-end route rather than pushing.
  const { canGoBack: historyCanGoBack } = useMiniAppRouteSegments("contacts");
  const backAction = useMemo(
    () =>
      route !== "selection" &&
      chromeOwnsRouteBackedDetailBack({ historyCanGoBack })
        ? {
            label: CONTACTS_LABELS.backToContactsAction,
            onBack: () => onBackToSelectionRoute({ replace: true }),
          }
        : null,
    [historyCanGoBack, onBackToSelectionRoute, route],
  );

  useMiniAppDetailBackAction(backAction);

  if (route === "new-contact") {
    return (
      <ContactsNewContactPanel
        canCreate={canCreate}
        createDraftContact={createDraftContact}
        draftFirstName={draftFirstName}
        draftLastName={draftLastName}
        draftNickname={draftNickname}
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
        error={importError}
        signInAction={params.signInAction}
        isAuthenticated={isAuthenticated}
        setDraftUserId={setDraftUserId}
      />
    );
  }

  return (
    <ContactsDetailContextTarget onAreaContextMenu={onAreaContextMenu}>
      <ContactsSelectionState
        addressActions={params.addressActions}
        resolveAddressWriter={params.resolveAddressWriter}
        blobStore={blobStore}
        currentSigningFingerprint={params.currentSigningFingerprint}
        currentUserId={params.currentUserId}
        entries={entries}
        ready={params.ready}
        removeContactAvatar={params.removeContactAvatar}
        selectedContactId={params.selectedContactId}
        setContactAvatar={params.setContactAvatar}
        updateContact={updateContact}
      />
    </ContactsDetailContextTarget>
  );
}
