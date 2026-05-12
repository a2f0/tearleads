import { type MouseEvent, useCallback, useMemo, useState } from "react";
import { Menu, type MenuPosition } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import type { ContactEntries } from "../types";

export interface ContactsContextMenuState {
  position: MenuPosition;
  userId: string;
}

export interface ContactsContextMenuModel {
  canRemoveContextMenuContact: boolean;
  closeContextMenu: () => void;
  contextMenu: ContactsContextMenuState | null;
  handleSidebarContextMenu: (
    event: MouseEvent<HTMLButtonElement>,
    userId: string,
  ) => void;
  removeContextMenuContact: () => Promise<void>;
}

export function useContactsContextMenu(params: {
  entries: ContactEntries;
  removeKey: (userId: string) => Promise<void>;
  selectedUserId: string | null;
  setSelectedUserId: (userId: string | null) => void;
}): ContactsContextMenuModel {
  const { entries, removeKey, selectedUserId, setSelectedUserId } = params;
  const [contextMenu, setContextMenu] =
    useState<ContactsContextMenuState | null>(null);
  const entriesByUserId = useMemo(
    () => new Map(entries.map((entry) => [entry.userId, entry])),
    [entries],
  );

  const handleSidebarContextMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, userId: string) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        position: { x: event.clientX, y: event.clientY },
        userId,
      });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const contextMenuEntry = contextMenu
    ? entriesByUserId.get(contextMenu.userId)
    : undefined;
  const canRemoveContextMenuContact = !(contextMenuEntry?.isSelf ?? false);

  const removeContextMenuContact = useCallback(async () => {
    if (!contextMenu) {
      return;
    }

    const { userId } = contextMenu;
    closeContextMenu();
    if (selectedUserId === userId) {
      setSelectedUserId(null);
    }
    await removeKey(userId);
  }, [
    closeContextMenu,
    contextMenu,
    removeKey,
    selectedUserId,
    setSelectedUserId,
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
