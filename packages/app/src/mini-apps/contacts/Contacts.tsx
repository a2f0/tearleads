import { useCallback, useEffect, useState } from "react";
import { usePeerUserId } from "../../components/pane/DualPaneProvider";
import { Menu, type MenuPosition } from "../../components/shared/Menu";
import { MenuItem } from "../../components/shared/MenuItem";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useContacts } from "./ContactsProvider";
import "./Contacts.css";

// Extract the time_low field (first 32 bits) from a UUID string.
function timeLow(uuid: string): string {
  return uuid.split("-")[0] ?? uuid;
}

export function Contacts() {
  const { entries, importKey, ready, removeKey } = useContacts();
  const { isAuthenticated } = useCryptoSession();
  const { setSidebar } = useWindowSidebar();
  const peerUserId = usePeerUserId();
  const [draftUserId, setDraftUserId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    position: MenuPosition;
    userId: string;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, userId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ position: { x: e.clientX, y: e.clientY }, userId });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (peerUserId) {
      setDraftUserId((currentId) => (currentId ? currentId : peerUserId));
    }
  }, [peerUserId]);

  useEffect(() => {
    setSidebar(
      <div className="contacts-sidebar">
        {!ready ? (
          <div className="contacts-hint">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="contacts-hint">No contacts.</div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.userId}
              type="button"
              className={
                "contacts-sidebar-item" +
                (selectedUserId === entry.userId
                  ? " contacts-sidebar-item--selected"
                  : "")
              }
              onClick={() => setSelectedUserId(entry.userId)}
              onContextMenu={(e) => handleContextMenu(e, entry.userId)}
            >
              {timeLow(entry.userId)}
            </button>
          ))
        )}
      </div>,
    );
    return () => setSidebar(null);
  }, [setSidebar, entries, ready, selectedUserId, handleContextMenu]);

  const selectedEntry = entries.find(
    (entry) => entry.userId === selectedUserId,
  );

  const canImport = ready && isAuthenticated && draftUserId.trim().length > 0;

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
      {selectedEntry ? (
        <div className="contacts-card" key={selectedEntry.userId}>
          <div>
            <strong>{selectedEntry.userId}</strong>
            <span>{selectedEntry.encapsulationPublicKey}</span>
          </div>
        </div>
      ) : (
        <div className="contacts-hint">
          {ready && entries.length > 0
            ? "Select a contact."
            : !ready
              ? "Loading contacts..."
              : "No contacts imported yet."}
        </div>
      )}
      {contextMenu && (
        <Menu position={contextMenu.position} onClose={closeContextMenu}>
          <MenuItem
            label="Remove"
            onClick={async () => {
              const userId = contextMenu.userId;
              closeContextMenu();
              if (selectedUserId === userId) {
                setSelectedUserId(null);
              }
              await removeKey(userId);
            }}
          />
        </Menu>
      )}
    </div>
  );
}
