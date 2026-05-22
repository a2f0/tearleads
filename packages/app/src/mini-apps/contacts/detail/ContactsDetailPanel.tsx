import {
  MiniAppButton,
  MiniAppField,
  MiniAppInput,
  MiniAppPanel,
  MiniAppStatus,
  MiniAppTextarea,
  MiniAppToolbar,
} from "../../../components/shared/MiniAppLayout";
import type { ContactEntries, ContactEntryPatch } from "../types";

type UpdateContact = (contactId: string, patch: ContactEntryPatch) => void;

function ContactTextField(params: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const { label, onCommit, placeholder, value } = params;

  return (
    <MiniAppField>
      <span>{label}</span>
      <MiniAppInput
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(event) => onCommit(event.currentTarget.value)}
      />
    </MiniAppField>
  );
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

  if (!selectedEntry) {
    return (
      <MiniAppStatus>
        {ready && entries.length > 0
          ? "Select a contact."
          : !ready
            ? "Loading contacts..."
            : "No contacts imported yet."}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppPanel key={selectedEntry.id} variant="framed">
      <ContactTextField
        label="First name"
        value={selectedEntry.firstName}
        onCommit={(firstName) => updateContact(selectedEntry.id, { firstName })}
      />
      <ContactTextField
        label="Last name"
        value={selectedEntry.lastName}
        onCommit={(lastName) => updateContact(selectedEntry.id, { lastName })}
      />
      <ContactTextField
        label="Tearleads user ID"
        value={selectedEntry.userId ?? ""}
        placeholder="Optional"
        onCommit={(userId) => updateContact(selectedEntry.id, { userId })}
      />
      <MiniAppField>
        <span>Public key</span>
        <MiniAppTextarea
          defaultValue={selectedEntry.encapsulationPublicKey ?? ""}
          placeholder="Optional"
          onBlur={(event) =>
            updateContact(selectedEntry.id, {
              encapsulationPublicKey: event.currentTarget.value,
            })
          }
        />
      </MiniAppField>
    </MiniAppPanel>
  );
}

export function ContactsDetailPanel(params: {
  canCreate: boolean;
  canImport: boolean;
  createDraftContact: () => Promise<void>;
  draftFirstName: string;
  draftLastName: string;
  draftUserId: string;
  entries: ContactEntries;
  importDraftContact: () => Promise<void>;
  isAuthenticated: boolean;
  ready: boolean;
  selectedContactId: string | null;
  setDraftFirstName: (firstName: string) => void;
  setDraftLastName: (lastName: string) => void;
  setDraftUserId: (userId: string) => void;
  updateContact: UpdateContact;
}) {
  const {
    canCreate,
    canImport,
    createDraftContact,
    draftFirstName,
    draftLastName,
    draftUserId,
    entries,
    importDraftContact,
    isAuthenticated,
    ready,
    selectedContactId,
    setDraftFirstName,
    setDraftLastName,
    setDraftUserId,
    updateContact,
  } = params;

  return (
    <>
      <MiniAppToolbar>
        <MiniAppInput
          aria-label="First name"
          value={draftFirstName}
          onChange={(event) => setDraftFirstName(event.target.value)}
          placeholder="First name"
        />
        <MiniAppInput
          aria-label="Last name"
          value={draftLastName}
          onChange={(event) => setDraftLastName(event.target.value)}
          placeholder="Last name"
        />
        <MiniAppButton
          disabled={!canCreate}
          onClick={() => {
            void createDraftContact();
          }}
        >
          Add
        </MiniAppButton>
      </MiniAppToolbar>
      <MiniAppToolbar>
        <MiniAppInput
          aria-label="Contact user ID"
          value={draftUserId}
          onChange={(event) => setDraftUserId(event.target.value)}
          placeholder="User ID"
        />
        <MiniAppButton
          disabled={!canImport}
          onClick={() => {
            void importDraftContact();
          }}
        >
          Import
        </MiniAppButton>
      </MiniAppToolbar>
      {!isAuthenticated && (
        <MiniAppStatus>Authenticate before importing peer keys.</MiniAppStatus>
      )}
      <ContactsSelectionState
        entries={entries}
        ready={ready}
        selectedContactId={selectedContactId}
        updateContact={updateContact}
      />
    </>
  );
}
