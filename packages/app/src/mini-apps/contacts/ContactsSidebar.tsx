import type { BlobStore } from "@symcrypt/client-sdk";
import type { MouseEvent, ReactNode } from "react";
import {
  MiniAppSidebar,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import {
  MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
  MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  useMiniAppVirtualRows,
} from "../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../components/shared/classNames";
import { ContactAvatar } from "../../document-types/contact/ContactAvatar";
import { getContactDisplayName } from "../../document-types/contact/contactDocumentModel";
import { useContactAvatarUrls } from "../../document-types/contact/useContactAvatarUrls";
import { getViewerRelativeContactLabel } from "../../stores/contacts/contactLabels";
import {
  createAreaContextMenuHandler,
  type MiniAppListPresentation,
  MiniAppRowActionsKebab,
  useMiniAppSidebarPanel,
} from "../shared/list-panel/MiniAppListPanel";
import type { ContactEntries } from "./types";

const CONTACTS_ROW_SELECTOR = ".contacts-sidebar-row, .mini-app-row";

interface ContactsSidebarProps {
  blobStore: BlobStore;
  currentSigningFingerprint: string | null | undefined;
  currentUserId: string | null | undefined;
  entries: ContactEntries;
  handleAreaContextMenu: (event: MouseEvent<HTMLElement>) => void;
  handleContextMenu: (
    event: MouseEvent<HTMLElement>,
    contactId: string,
  ) => void;
  ready: boolean;
  selectedContactId: string | null;
  setSelectedContactId: (contactId: string) => void;
}

type ContactsListProps = ContactsSidebarProps & MiniAppListPresentation;

function normalizeContactNamePart(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

// The list-home rows carry a second line only when the contact's full name says
// something the display name leaves out — a nickname hiding the real name. Sync
// and key state stay out of it; the row is for identifying the person.
function getContactMetadataLabel(entry: ContactEntries[number]): string | null {
  const displayName = getContactDisplayName(entry);
  const firstName = normalizeContactNamePart(entry.firstName);
  const lastName = normalizeContactNamePart(entry.lastName);
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName.length > 0 && fullName !== displayName ? fullName : null;
}

function renderContactMetadata(entry: ContactEntries[number]): ReactNode {
  const metadataLabel = getContactMetadataLabel(entry);
  return metadataLabel ? (
    <MiniAppRowText muted>{metadataLabel}</MiniAppRowText>
  ) : null;
}

function ContactsList({
  bleed = false,
  blobStore,
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
  const avatarUrlByContactId = useContactAvatarUrls(entries, blobStore);
  // The roomy list-home rows fit the larger thumbnail; the narrow sidebar
  // keeps the small one.
  const avatarSize = showMetadata ? "medium" : "small";

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
      className={classNames(
        bleed && "mini-app-virtual-list-frame--bleed",
        // The list home fills its route, so it also bleeds its bottom edge to
        // sit flush against the mobile task bar.
        bleed && "mini-app-virtual-list-frame--bleed-block-end",
      )}
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
                <ContactAvatar
                  imageUrl={avatarUrlByContactId[entry.id]}
                  size={avatarSize}
                />
                {showMetadata ? (
                  <MiniAppRowStack>
                    <MiniAppRowText>{name}</MiniAppRowText>
                    {renderContactMetadata(entry)}
                  </MiniAppRowStack>
                ) : (
                  <MiniAppRowText>{name}</MiniAppRowText>
                )}
              </MiniAppRowButton>
              {showActions ? (
                <MiniAppRowActionsKebab
                  openContextMenu={(event) =>
                    handleContextMenu(event, entry.id)
                  }
                  rowName={name}
                />
              ) : null}
            </MiniAppVirtualListRow>
          );
        })}
      </MiniAppVirtualList>
    </MiniAppVirtualListFrame>
  );
}

export function ContactsListHome(props: ContactsSidebarProps) {
  return (
    <section
      aria-label="Contacts list"
      className="contacts-list-home"
      onContextMenu={createAreaContextMenuHandler(
        CONTACTS_ROW_SELECTOR,
        props.handleAreaContextMenu,
      )}
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

function ContactsSidebar(
  props: ContactsSidebarProps & { showActions: boolean },
) {
  return (
    <MiniAppSidebar
      className="mini-app-sidebar--virtual"
      onContextMenu={createAreaContextMenuHandler(
        CONTACTS_ROW_SELECTOR,
        props.handleAreaContextMenu,
      )}
    >
      <ContactsList {...props} />
    </MiniAppSidebar>
  );
}

export function useContactsSidebarPanel(
  params: ContactsSidebarProps & { setSidebar: (sidebar: ReactNode) => void },
) {
  const { setSidebar, ...props } = params;
  useMiniAppSidebarPanel({ Sidebar: ContactsSidebar, props, setSidebar });
}
