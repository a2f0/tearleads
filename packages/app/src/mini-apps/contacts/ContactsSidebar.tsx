import { type MouseEvent, type ReactNode, useEffect, useMemo } from "react";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import type { ContactEntries } from "./types";

// Extract the time_low field (first 32 bits) from a UUID string.
function timeLow(uuid: string): string {
  return uuid.split("-")[0] ?? uuid;
}

function getSidebarContactLabel(entry: ContactEntries[number]): string {
  const name = `${entry.firstName} ${entry.lastName}`.trim();
  const label =
    name.length > 0
      ? name
      : entry.userId
        ? timeLow(entry.userId)
        : "Untitled contact";

  return entry.isSelf ? `${label} (me)` : label;
}

function ContactsSidebarEntries({
  entries,
  handleContextMenu,
  ready,
  selectedContactId,
  setSelectedContactId,
}: {
  entries: ContactEntries;
  handleContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    contactId: string,
  ) => void;
  ready: boolean;
  selectedContactId: string | null;
  setSelectedContactId: (contactId: string) => void;
}) {
  if (!ready) {
    return <div className="contacts-hint">Loading...</div>;
  }

  if (entries.length === 0) {
    return <div className="contacts-hint">No contacts.</div>;
  }

  function handlePrimaryMouseDown(
    event: MouseEvent<HTMLButtonElement>,
    contactId: string,
  ) {
    if (event.button !== 0) {
      return;
    }

    const activeElement = event.currentTarget.ownerDocument.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement !== event.currentTarget
    ) {
      activeElement.blur();
    }
    setSelectedContactId(contactId);
  }

  return (
    <>
      {entries.map((entry) => (
        <MiniAppRowButton
          key={entry.id}
          className="contacts-sidebar-item"
          onClick={() => setSelectedContactId(entry.id)}
          onMouseDown={(event) => handlePrimaryMouseDown(event, entry.id)}
          onContextMenu={(event) => handleContextMenu(event, entry.id)}
          selected={selectedContactId === entry.id}
        >
          <MiniAppRowText>{getSidebarContactLabel(entry)}</MiniAppRowText>
        </MiniAppRowButton>
      ))}
    </>
  );
}

export function useContactsSidebarPanel(params: {
  entries: ContactEntries;
  handleContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    contactId: string,
  ) => void;
  ready: boolean;
  selectedContactId: string | null;
  setSelectedContactId: (contactId: string) => void;
  setSidebar: (sidebar: ReactNode) => void;
}) {
  const {
    entries,
    handleContextMenu,
    ready,
    selectedContactId,
    setSelectedContactId,
    setSidebar,
  } = params;

  const sidebar = useMemo(
    () => (
      <div className="contacts-sidebar">
        <ContactsSidebarEntries
          entries={entries}
          handleContextMenu={handleContextMenu}
          ready={ready}
          selectedContactId={selectedContactId}
          setSelectedContactId={setSelectedContactId}
        />
      </div>
    ),
    [
      entries,
      handleContextMenu,
      ready,
      selectedContactId,
      setSelectedContactId,
    ],
  );

  useEffect(() => {
    setSidebar(sidebar);
    return () => setSidebar(null);
  }, [setSidebar, sidebar]);
}
