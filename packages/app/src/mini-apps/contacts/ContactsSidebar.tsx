import { type MouseEvent, type ReactNode, useMemo } from "react";
import {
  MiniAppSidebar,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import {
  MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
import { useRegisteredWindowSidebar } from "../../components/window/WindowSidebarContext";
import { getContactDisplayName } from "../../document-types/contact/contactDocumentModel";
import type { ContactEntries } from "./types";

// Extract the time_low field (first 32 bits) from a UUID string.
function timeLow(uuid: string): string {
  return uuid.split("-")[0] ?? uuid;
}

function getSidebarContactLabel(entry: ContactEntries[number]): string {
  const name = getContactDisplayName(entry);
  return name.length > 0
    ? name
    : entry.isSelf
      ? "You"
      : entry.userId
        ? timeLow(entry.userId)
        : "Untitled contact";
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
    event: MouseEvent<HTMLElement>,
    contactId: string,
  ) => void;
  ready: boolean;
  selectedContactId: string | null;
  setSelectedContactId: (contactId: string) => void;
}) {
  const virtualEntries = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
    rows: entries,
  });

  if (!ready) {
    return <MiniAppStatus>Loading...</MiniAppStatus>;
  }

  if (entries.length === 0) {
    return <MiniAppStatus>No contacts.</MiniAppStatus>;
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
    <MiniAppVirtualListFrame
      ref={virtualEntries.frameRef}
      rowHeight={MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT}
    >
      <MiniAppVirtualList
        bottomPadding={virtualEntries.bottomPadding}
        topPadding={virtualEntries.topPadding}
      >
        {virtualEntries.rows.map((entry) => (
          <MiniAppVirtualListRow
            className="contacts-sidebar-row"
            key={entry.id}
          >
            <MiniAppRowButton
              onClick={() => setSelectedContactId(entry.id)}
              onMouseDown={(event) => handlePrimaryMouseDown(event, entry.id)}
              onContextMenu={(event) => handleContextMenu(event, entry.id)}
              selected={selectedContactId === entry.id}
            >
              <MiniAppRowText>{getSidebarContactLabel(entry)}</MiniAppRowText>
            </MiniAppRowButton>
          </MiniAppVirtualListRow>
        ))}
      </MiniAppVirtualList>
    </MiniAppVirtualListFrame>
  );
}

function isContactsSidebarAreaContextMenuTarget(
  event: MouseEvent<HTMLElement>,
): boolean {
  return (
    !(event.target instanceof Element) ||
    !event.target.closest(".contacts-sidebar-row, .mini-app-row")
  );
}

export function useContactsSidebarPanel(params: {
  entries: ContactEntries;
  handleAreaContextMenu: (event: MouseEvent<HTMLElement>) => void;
  handleContextMenu: (
    event: MouseEvent<HTMLElement>,
    contactId: string,
  ) => void;
  ready: boolean;
  selectedContactId: string | null;
  setSelectedContactId: (contactId: string) => void;
  setSidebar: (sidebar: ReactNode) => void;
}) {
  const {
    entries,
    handleAreaContextMenu,
    handleContextMenu,
    ready,
    selectedContactId,
    setSelectedContactId,
    setSidebar,
  } = params;

  const sidebar = useMemo(
    () => (
      <MiniAppSidebar
        className="mini-app-sidebar--virtual"
        onContextMenu={(event) => {
          if (
            event.defaultPrevented ||
            !isContactsSidebarAreaContextMenuTarget(event)
          ) {
            return;
          }

          handleAreaContextMenu(event);
        }}
      >
        <ContactsSidebarEntries
          entries={entries}
          handleContextMenu={handleContextMenu}
          ready={ready}
          selectedContactId={selectedContactId}
          setSelectedContactId={setSelectedContactId}
        />
      </MiniAppSidebar>
    ),
    [
      entries,
      handleAreaContextMenu,
      handleContextMenu,
      ready,
      selectedContactId,
      setSelectedContactId,
    ],
  );

  useRegisteredWindowSidebar({ setSidebar, sidebar });
}
