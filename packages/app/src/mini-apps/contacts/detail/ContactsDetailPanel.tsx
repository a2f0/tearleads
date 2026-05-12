import type { ContactEntries } from "../types";

function ContactsSelectionState({
  entries,
  ready,
  selectedUserId,
}: {
  entries: ContactEntries;
  ready: boolean;
  selectedUserId: string | null;
}) {
  const selectedEntry = entries.find(
    (entry) => entry.userId === selectedUserId,
  );

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
    <div className="contacts-card" key={selectedEntry.userId}>
      <div>
        <strong>{selectedEntry.userId}</strong>
        <span>{selectedEntry.encapsulationPublicKey}</span>
      </div>
    </div>
  );
}

export function ContactsDetailPanel(params: {
  canImport: boolean;
  draftUserId: string;
  entries: ContactEntries;
  importDraftContact: () => Promise<void>;
  isAuthenticated: boolean;
  ready: boolean;
  selectedUserId: string | null;
  setDraftUserId: (userId: string) => void;
}) {
  const {
    canImport,
    draftUserId,
    entries,
    importDraftContact,
    isAuthenticated,
    ready,
    selectedUserId,
    setDraftUserId,
  } = params;

  return (
    <>
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
        selectedUserId={selectedUserId}
      />
    </>
  );
}
