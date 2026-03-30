import { useEffect, useState } from "react";
import { usePeerUserId } from "../../components/pane/DualPaneProvider";
import { useContacts } from "../../contacts/ContactsProvider";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import "./Contacts.css";

export function Contacts() {
  const { entries, importKey, removeKey } = useContacts();
  const { isAuthenticated } = useCryptoSession();
  const peerUserId = usePeerUserId();
  const [draftUserId, setDraftUserId] = useState("");

  useEffect(() => {
    if (peerUserId) {
      setDraftUserId((currentId) => (currentId ? currentId : peerUserId));
    }
  }, [peerUserId]);

  const canImport = isAuthenticated && draftUserId.trim().length > 0;

  return (
    <div className="contacts">
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
          onClick={async () => {
            await importKey(draftUserId.trim());
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
      {entries.length === 0 ? (
        <div className="contacts-hint">No contacts imported yet.</div>
      ) : (
        <div className="contacts-list">
          {entries.map((entry) => (
            <div className="contacts-card" key={entry.userId}>
              <div>
                <strong>{entry.userId}</strong>
                <span>{entry.encapsulationPublicKey}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  removeKey(entry.userId);
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
