import { type MouseEvent, type ReactNode, useEffect, useMemo } from "react";
import type { ContactEntries } from "./types";

// Extract the time_low field (first 32 bits) from a UUID string.
function timeLow(uuid: string): string {
  return uuid.split("-")[0] ?? uuid;
}

function ContactsSidebarEntries({
  entries,
  handleContextMenu,
  ready,
  selectedUserId,
  setSelectedUserId,
}: {
  entries: ContactEntries;
  handleContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    userId: string,
  ) => void;
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

export function useContactsSidebarPanel(params: {
  entries: ContactEntries;
  handleContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    userId: string,
  ) => void;
  ready: boolean;
  selectedUserId: string | null;
  setSelectedUserId: (userId: string) => void;
  setSidebar: (sidebar: ReactNode) => void;
}) {
  const {
    entries,
    handleContextMenu,
    ready,
    selectedUserId,
    setSelectedUserId,
    setSidebar,
  } = params;

  const sidebar = useMemo(
    () => (
      <div className="contacts-sidebar">
        <ContactsSidebarEntries
          entries={entries}
          handleContextMenu={handleContextMenu}
          ready={ready}
          selectedUserId={selectedUserId}
          setSelectedUserId={setSelectedUserId}
        />
      </div>
    ),
    [entries, handleContextMenu, ready, selectedUserId, setSelectedUserId],
  );

  useEffect(() => {
    setSidebar(sidebar);
    return () => setSidebar(null);
  }, [setSidebar, sidebar]);
}
