import { type MouseEvent, type ReactNode, useMemo } from "react";
import { classNames } from "../../components/shared/classNames";
import {
  MiniAppSidebar,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import { MiniAppRowActionsButton } from "../../components/shared/MiniAppTable";
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
import { CONTACTS_LABELS } from "./labels";
import type { ContactEntries } from "./types";

interface ContactsListProps {
  // Bleed the list to the screen edges on the mobile list home (the narrow
  // sidebar stays inset).
  bleed?: boolean | undefined;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  // Draw divider lines between entries (the mobile list home; the narrow
  // sidebar leaves them off).
  divided?: boolean | undefined;
  entries: ContactEntries;
  handleContextMenu: (
    event: MouseEvent<HTMLElement>,
    contactId: string,
  ) => void;
  ready: boolean;
  rowHeight?: number | undefined;
  selectedContactId: string | null;
  setSelectedContactId: (contactId: string) => void;
  // Render a trailing kebab that opens the row's context menu (the mobile list
  // home; the sidebar relies on right-click / long-press).
  showActions?: boolean | undefined;
  showMetadata?: boolean | undefined;
}

function normalizeContactNamePart(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function getContactMetadataLabel(entry: ContactEntries[number]): string {
  const displayName = getContactDisplayName(entry);
  const firstName = normalizeContactNamePart(entry.firstName);
  const lastName = normalizeContactNamePart(entry.lastName);
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName.length > 0 && fullName !== displayName) {
    return fullName;
  }

  if (entry.userId) {
    return `${CONTACTS_LABELS.metadataUserPrefix} ${entry.userId.slice(0, 8)}`;
  }

  if (entry.encapsulationPublicKey) {
    return CONTACTS_LABELS.metadataImportedKey;
  }

  return CONTACTS_LABELS.metadataLocalContact;
}

function ContactsList({
  bleed = false,
  currentSigningFingerprint,
  currentUserId,
  divided = false,
  entries,
  handleContextMenu,
  ready,
  rowHeight = MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  selectedContactId,
  setSelectedContactId,
  showActions = false,
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
      className={bleed ? "mini-app-virtual-list-frame--bleed" : undefined}
      ref={virtualEntries.frameRef}
      rowHeight={rowHeight}
    >
      <MiniAppVirtualList
        bottomPadding={virtualEntries.bottomPadding}
        className={divided ? "mini-app-virtual-list--divided" : undefined}
        topPadding={virtualEntries.topPadding}
      >
        {virtualEntries.rows.map((entry) => {
          const name = getViewerRelativeContactLabel(
            entry,
            currentSigningFingerprint,
            currentUserId,
          );
          return (
            <MiniAppVirtualListRow
              className={classNames(
                "contacts-sidebar-row",
                showActions && "mini-app-virtual-list-row--actions",
              )}
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
                    <MiniAppRowText>{name}</MiniAppRowText>
                    <MiniAppRowText muted>
                      {getContactMetadataLabel(entry)}
                    </MiniAppRowText>
                  </MiniAppRowStack>
                ) : (
                  <MiniAppRowText>{name}</MiniAppRowText>
                )}
              </MiniAppRowButton>
              {showActions ? (
                <MiniAppRowActionsButton
                  aria-label={`${CONTACTS_LABELS.rowActionsButtonPrefix} ${name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleContextMenu(event, entry.id);
                  }}
                  onContextMenu={(event) => {
                    event.stopPropagation();
                    handleContextMenu(event, entry.id);
                  }}
                  title={`${CONTACTS_LABELS.rowActionsButtonPrefix} ${name}`}
                />
              ) : null}
            </MiniAppVirtualListRow>
          );
        })}
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
        bleed
        divided
        rowHeight={MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}
        showActions
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
