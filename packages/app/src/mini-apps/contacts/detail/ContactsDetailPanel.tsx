import type { ContactEntryPatch } from "../../../data/contacts/addressBookEntry";
import type { ContactEntries } from "../types";

type UpdateContact = (contactId: string, patch: ContactEntryPatch) => void;

function ContactTextField(params: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const { label, onCommit, placeholder, value } = params;

  return (
    <label className="contacts-field">
      <span>{label}</span>
      <input
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(event) => onCommit(event.currentTarget.value)}
      />
    </label>
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
      <div className="contacts-hint">
        {ready && entries.length > 0
          ? "Select a contact."
          : !ready
            ? "Loading contacts..."
            : "No contacts imported yet."}
      </div>
    );
  }

  return (
    <div className="contacts-card" key={selectedEntry.id}>
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
      <label className="contacts-field">
        <span>Public key</span>
        <textarea
          defaultValue={selectedEntry.encapsulationPublicKey ?? ""}
          placeholder="Optional"
          onBlur={(event) =>
            updateContact(selectedEntry.id, {
              encapsulationPublicKey: event.currentTarget.value,
            })
          }
        />
      </label>
    </div>
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
      <div className="contacts-toolbar">
        <input
          aria-label="First name"
          value={draftFirstName}
          onChange={(event) => setDraftFirstName(event.target.value)}
          placeholder="First name"
        />
        <input
          aria-label="Last name"
          value={draftLastName}
          onChange={(event) => setDraftLastName(event.target.value)}
          placeholder="Last name"
        />
        <button
          type="button"
          disabled={!canCreate}
          onClick={() => {
            void createDraftContact();
          }}
        >
          Add
        </button>
      </div>
      <div className="contacts-toolbar">
        <input
          aria-label="Contact user ID"
          value={draftUserId}
          onChange={(event) => setDraftUserId(event.target.value)}
          placeholder="User ID"
        />
        <button
          type="button"
          disabled={!canImport}
          onClick={() => {
            void importDraftContact();
          }}
        >
          Import
        </button>
      </div>
      {!isAuthenticated && (
        <div className="contacts-hint">
          Authenticate before importing peer keys.
        </div>
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
