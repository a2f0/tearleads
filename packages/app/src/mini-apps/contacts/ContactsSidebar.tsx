import { type MouseEvent, type ReactNode, useMemo } from "react";
import {
  MiniAppSidebar,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import {
  MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
  MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
import { useRegisteredWindowSidebar } from "../../components/window/WindowSidebarContext";
import { getContactDisplayName } from "../../document-types/contact/contactDocumentModel";
import { getViewerRelativeContactLabel } from "../../stores/contacts/contactLabels";
import type { ContactEntries } from "./types";

interface ContactsListProps {
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  entries: ContactEntries;
  handleContextMenu: (
    event: MouseEvent<HTMLElement>,
    contactId: string,
  ) => void;
  ready: boolean;
  rowHeight?: number | undefined;
  selectedContactId: string | null;
  setSelectedContactId: (contactId: string) => void;
  showMetadata?: boolean | undefined;
}

function getContactMetadataLabel(entry: ContactEntries[number]): string {
  const displayName = getContactDisplayName(entry);
  const fullName = `${entry.firstName} ${entry.lastName}`.trim();
  if (fullName.length > 0 && fullName !== displayName) {
    return fullName;
  }

  if (entry.userId) {
    return `User ${entry.userId.slice(0, 8)}`;
  }

  if (entry.encapsulationPublicKey) {
    return "Imported key";
  }

  return "Local contact";
}

function ContactsList({
  currentSigningFingerprint,
  currentUserId,
  entries,
  handleContextMenu,
  ready,
  rowHeight = MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  selectedContactId,
  setSelectedContactId,
  showMetadata = false,
}: ContactsListProps) {
  const virtualEntries = useMiniAppVirtualRows({
    rowHeight,
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
      rowHeight={rowHeight}
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
              {showMetadata ? (
                <MiniAppRowStack>
                  <MiniAppRowText>
                    {getViewerRelativeContactLabel(
                      entry,
                      currentSigningFingerprint,
                      currentUserId,
                    )}
                  </MiniAppRowText>
                  <MiniAppRowText muted>
                    {getContactMetadataLabel(entry)}
                  </MiniAppRowText>
                </MiniAppRowStack>
              ) : (
                <MiniAppRowText>
                  {getViewerRelativeContactLabel(
                    entry,
                    currentSigningFingerprint,
                    currentUserId,
                  )}
                </MiniAppRowText>
              )}
            </MiniAppRowButton>
          </MiniAppVirtualListRow>
        ))}
      </MiniAppVirtualList>
    </MiniAppVirtualListFrame>
  );
}

function isContactsListAreaContextMenuTarget(
  event: MouseEvent<HTMLElement>,
): boolean {
  return (
    !(event.target instanceof Element) ||
    !event.target.closest(".contacts-sidebar-row, .mini-app-row")
  );
}

export function ContactsListHome(
  props: ContactsListProps & {
    handleAreaContextMenu: (event: MouseEvent<HTMLElement>) => void;
  },
) {
  return (
    <section
      aria-label="Contacts list"
      className="contacts-list-home"
      onContextMenu={(event) => {
        if (
          event.defaultPrevented ||
          !isContactsListAreaContextMenuTarget(event)
        ) {
          return;
        }

        props.handleAreaContextMenu(event);
      }}
    >
      <ContactsList
        {...props}
        rowHeight={MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}
        showMetadata
      />
    </section>
  );
}

export function useContactsSidebarPanel(params: {
  currentSigningFingerprint?: string | null | undefined;
  currentUserId?: string | null | undefined;
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
    currentSigningFingerprint,
    currentUserId,
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
            !isContactsListAreaContextMenuTarget(event)
          ) {
            return;
          }

          handleAreaContextMenu(event);
        }}
      >
        <ContactsList
          currentSigningFingerprint={currentSigningFingerprint}
          currentUserId={currentUserId}
          entries={entries}
          handleContextMenu={handleContextMenu}
          ready={ready}
          selectedContactId={selectedContactId}
          setSelectedContactId={setSelectedContactId}
        />
      </MiniAppSidebar>
    ),
    [
      currentSigningFingerprint,
      currentUserId,
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
