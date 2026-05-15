import { type MouseEvent, useCallback, useMemo, useState } from "react";
import { Menu, type MenuPosition } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import type { ContactEntries } from "../types";

export interface ContactsContextMenuState {
  contactId: string;
  position: MenuPosition;
}

export interface ContactsContextMenuModel {
  canRemoveContextMenuContact: boolean;
  closeContextMenu: () => void;
  contextMenu: ContactsContextMenuState | null;
  handleSidebarContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    contactId: string,
  ) => void;
  removeContextMenuContact: () => Promise<void>;
}

export function useContactsContextMenu(params: {
  entries: ContactEntries;
  removeContact: (contactId: string) => Promise<void>;
  selectedContactId: string | null;
  setSelectedContactId: (contactId: string | null) => void;
}): ContactsContextMenuModel {
  const { entries, removeContact, selectedContactId, setSelectedContactId } =
    params;
  const [contextMenu, setContextMenu] =
    useState<ContactsContextMenuState | null>(null);
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );

  const handleSidebarContextMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, contactId: string) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        contactId,
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const contextMenuEntry = contextMenu
    ? entriesById.get(contextMenu.contactId)
    : undefined;
  const canRemoveContextMenuContact = !(contextMenuEntry?.isSelf ?? false);

  const removeContextMenuContact = useCallback(async () => {
    if (!contextMenu) {
      return;
    }

    const { contactId } = contextMenu;
    closeContextMenu();
    if (selectedContactId === contactId) {
      setSelectedContactId(null);
    }
    await removeContact(contactId);
  }, [
    closeContextMenu,
    contextMenu,
    removeContact,
    selectedContactId,
    setSelectedContactId,
  ]);

  return {
    canRemoveContextMenuContact,
    closeContextMenu,
    contextMenu,
    handleSidebarContextMenu,
    removeContextMenuContact,
  };
}

export function ContactsContextMenuLayer(params: {
  canRemoveContextMenuContact: boolean;
  closeContextMenu: () => void;
  contextMenu: ContactsContextMenuState | null;
  removeContextMenuContact: () => Promise<void>;
}) {
  const {
    canRemoveContextMenuContact,
    closeContextMenu,
    contextMenu,
    removeContextMenuContact,
  } = params;

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
        disabled={!canRemoveContextMenuContact}
        onClick={() => {
          void removeContextMenuContact();
        }}
      />
    </Menu>
  );
}
