import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePeerUserId } from "../../components/pane/DualPaneProvider";
import { Menu, type MenuPosition } from "../../components/shared/Menu";
import { MenuItem } from "../../components/shared/MenuItem";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useContacts } from "./providers/ContactsProvider";
import "./Contacts.css";

interface ContactsContextMenuState {
  position: MenuPosition;
  userId: string;
}

// Extract the time_low field (first 32 bits) from a UUID string.
function timeLow(uuid: string): string {
  return uuid.split("-")[0] ?? uuid;
}

function ContactsSidebar({
  entries,
  handleContextMenu,
  ready,
  selectedUserId,
  setSelectedUserId,
}: {
  entries: ReturnType<typeof useContacts>["entries"];
  handleContextMenu: (event: MouseEvent, userId: string) => void;
  ready: boolean;
  selectedUserId: string | null;
  setSelectedUserId: (userId: string) => void;
}) {
  if (!ready) {
    return <div className="contacts-hint">Loading...</div>;
  }

  if (entries.length === 0) {
    return <div className="contacts-hint">No contacts.</div>;
  }

  return (
    <>
      {entries.map((entry) => (
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
          onContextMenu={(event) => handleContextMenu(event, entry.userId)}
        >
          {entry.isSelf
            ? `${timeLow(entry.userId)} (me)`
            : timeLow(entry.userId)}
        </button>
      ))}
    </>
  );
}

function ContactsSelectionState({
  entries,
  ready,
  selectedUserId,
}: {
  entries: ReturnType<typeof useContacts>["entries"];
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

function ContactsContextMenu({
  closeContextMenu,
  contextMenu,
  entries,
  removeKey,
  selectedUserId,
  setSelectedUserId,
}: {
  closeContextMenu: () => void;
  contextMenu: ContactsContextMenuState | null;
  entries: ReturnType<typeof useContacts>["entries"];
  removeKey: ReturnType<typeof useContacts>["removeKey"];
  selectedUserId: string | null;
  setSelectedUserId: (userId: string | null) => void;
}) {
  if (!contextMenu) {
    return null;
  }

  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      <MenuItem
        label="Remove"
        disabled={
          entries.find((entry) => entry.userId === contextMenu.userId)
            ?.isSelf ?? false
        }
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
  );
}

export function Contacts() {
  const { entries, importKey, ready, removeKey } = useContacts();
  const { isAuthenticated, userId: sessionUserId } = useCryptoSession();
  const { setSidebar } = useWindowSidebar();
  const peerUserId = usePeerUserId();
  const [draftUserId, setDraftUserId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] =
    useState<ContactsContextMenuState | null>(null);

  const handleContextMenu = useCallback((e: MouseEvent, userId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, userId });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const selfImportedRef = useRef(false);

  useEffect(() => {
    if (
      ready &&
      isAuthenticated &&
      sessionUserId &&
      !selfImportedRef.current &&
      !entries.some((entry) => entry.isSelf || entry.userId === sessionUserId)
    ) {
      selfImportedRef.current = true;
      importKey(sessionUserId);
    }
  }, [ready, isAuthenticated, sessionUserId, entries, importKey]);

  useEffect(() => {
    if (peerUserId) {
      setDraftUserId((currentId) => (currentId ? currentId : peerUserId));
    }
  }, [peerUserId]);

  useEffect(() => {
    setSidebar(
      <div className="contacts-sidebar">
        <ContactsSidebar
          entries={entries}
          handleContextMenu={handleContextMenu}
          ready={ready}
          selectedUserId={selectedUserId}
          setSelectedUserId={setSelectedUserId}
        />
      </div>,
    );
    return () => setSidebar(null);
  }, [setSidebar, entries, ready, selectedUserId, handleContextMenu]);

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
      <ContactsSelectionState
        entries={entries}
        ready={ready}
        selectedUserId={selectedUserId}
      />
      <ContactsContextMenu
        closeContextMenu={closeContextMenu}
        contextMenu={contextMenu}
        entries={entries}
        removeKey={removeKey}
        selectedUserId={selectedUserId}
        setSelectedUserId={setSelectedUserId}
      />
    </div>
  );
}
