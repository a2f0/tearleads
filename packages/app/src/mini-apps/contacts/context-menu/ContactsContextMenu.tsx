import { type MouseEvent, useCallback, useMemo } from "react";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";
import type { ContactEntries } from "../types";

export type ContactsContextMenuState = ContextMenuState;

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
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState();
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );

  const handleSidebarContextMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, contactId: string) => {
      openContextMenu(event, contactId);
    },
    [openContextMenu],
  );

  const contextMenuEntry = contextMenu
    ? entriesById.get(contextMenu.id)
    : undefined;
  const canRemoveContextMenuContact = !(contextMenuEntry?.isSelf ?? false);

  const removeContextMenuContact = useCallback(async () => {
    if (!contextMenu) {
      return;
    }

    const contactId = contextMenu.id;
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
