import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { ClipboardIcon } from "@phosphor-icons/react/dist/csr/Clipboard";
import { UserMinusIcon } from "@phosphor-icons/react/dist/csr/UserMinus";
import { type MouseEvent, useCallback, useMemo } from "react";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";
import { NewContactIcon } from "../../shared/newContactIcon";
import { CONTACTS_LABELS } from "../labels";
import type { ContactEntries } from "../types";

export type ContactsContextMenuTarget =
  | { kind: "area" }
  | { contactId: string; kind: "contact" };

export type ContactsContextMenuState =
  ContextMenuState<ContactsContextMenuTarget>;

export interface ContactsContextMenuModel {
  canRemoveContextMenuContact: boolean;
  closeContextMenu: () => void;
  contextMenuContactUserId: string | null;
  contextMenu: ContactsContextMenuState | null;
  handleAreaContextMenu: (event: MouseEvent<HTMLElement>) => void;
  handleSidebarContextMenu: (
    event: MouseEvent<HTMLElement>,
    contactId: string,
  ) => void;
  removeContextMenuContact: () => Promise<void>;
}

export function useContactsContextMenu(params: {
  canWrite: boolean;
  entries: ContactEntries;
  removeContact: (contactId: string) => Promise<void>;
  selectedContactId: string | null;
  setSelectedContactId: (contactId: string | null) => void;
}): ContactsContextMenuModel {
  const {
    canWrite,
    entries,
    removeContact,
    selectedContactId,
    setSelectedContactId,
  } = params;
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<ContactsContextMenuTarget>();
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );

  const handleAreaContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      openContextMenu(event, { kind: "area" });
    },
    [openContextMenu],
  );

  const handleSidebarContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, contactId: string) => {
      openContextMenu(event, { contactId, kind: "contact" });
    },
    [openContextMenu],
  );

  const contextMenuEntry =
    contextMenu?.id.kind === "contact"
      ? entriesById.get(contextMenu.id.contactId)
      : undefined;
  const canRemoveContextMenuContact = Boolean(
    canWrite &&
      contextMenu?.id.kind === "contact" &&
      contextMenuEntry !== undefined &&
      contextMenuEntry.canWrite !== false &&
      !contextMenuEntry.isSelf,
  );
  const contextMenuContactUserId =
    contextMenu?.id.kind === "contact"
      ? (contextMenuEntry?.userId ?? null)
      : null;

  const removeContextMenuContact = useCallback(async () => {
    if (
      !contextMenu ||
      contextMenu.id.kind !== "contact" ||
      !canRemoveContextMenuContact
    ) {
      return;
    }

    const contactId = contextMenu.id.contactId;
    closeContextMenu();
    if (selectedContactId === contactId) {
      setSelectedContactId(null);
    }
    await removeContact(contactId);
  }, [
    closeContextMenu,
    canRemoveContextMenuContact,
    contextMenu,
    removeContact,
    selectedContactId,
    setSelectedContactId,
  ]);

  return {
    canRemoveContextMenuContact,
    closeContextMenu,
    contextMenuContactUserId,
    contextMenu,
    handleAreaContextMenu,
    handleSidebarContextMenu,
    removeContextMenuContact,
  };
}

export function ContactsContextMenuLayer(params: {
  canRemoveContextMenuContact: boolean;
  canWrite: boolean;
  closeContextMenu: () => void;
  contextMenuContactUserId: string | null;
  contextMenu: ContactsContextMenuState | null;
  openImportContactRoute: () => void;
  openNewContactRoute: () => void;
  ready: boolean;
  removeContextMenuContact: () => Promise<void>;
}) {
  const {
    canRemoveContextMenuContact,
    canWrite,
    closeContextMenu,
    contextMenuContactUserId,
    contextMenu,
    openImportContactRoute,
    openNewContactRoute,
    ready,
    removeContextMenuContact,
  } = params;

  if (!contextMenu) {
    return null;
  }

  const clipboard =
    typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  const canCopyContextMenuContactUserId = Boolean(
    contextMenuContactUserId && clipboard,
  );

  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      {contextMenu.id.kind === "area" ? (
        <>
          <MenuItem
            icon={NewContactIcon}
            label={CONTACTS_LABELS.newContactAction}
            disabled={!ready || !canWrite}
            onClick={() => {
              closeContextMenu();
              openNewContactRoute();
            }}
          />
          <MenuItem
            icon={AddressBookIcon}
            label={CONTACTS_LABELS.importContactAction}
            disabled={!ready || !canWrite}
            onClick={() => {
              closeContextMenu();
              openImportContactRoute();
            }}
          />
        </>
      ) : (
        <>
          {canCopyContextMenuContactUserId && contextMenuContactUserId && (
            <MenuItem
              icon={ClipboardIcon}
              label={CONTACTS_LABELS.copyUserIdAction}
              onClick={() => {
                closeContextMenu();
                void clipboard
                  ?.writeText(contextMenuContactUserId)
                  .catch(() => undefined);
              }}
            />
          )}
          <MenuItem
            icon={UserMinusIcon}
            label={CONTACTS_LABELS.removeContactAction}
            disabled={!canRemoveContextMenuContact}
            onClick={() => {
              void removeContextMenuContact();
            }}
          />
        </>
      )}
    </Menu>
  );
}
