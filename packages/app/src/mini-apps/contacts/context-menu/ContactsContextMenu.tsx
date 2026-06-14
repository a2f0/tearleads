import { type MouseEvent, useCallback, useMemo } from "react";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";
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
  contextMenu: ContactsContextMenuState | null;
  handleAreaContextMenu: (event: MouseEvent<HTMLElement>) => void;
  handleSidebarContextMenu: (
    event: MouseEvent<HTMLElement>,
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
  const canRemoveContextMenuContact =
    contextMenu?.id.kind === "contact" && !(contextMenuEntry?.isSelf ?? false);

  const removeContextMenuContact = useCallback(async () => {
    if (!contextMenu || contextMenu.id.kind !== "contact") {
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
    contextMenu,
    removeContact,
    selectedContactId,
    setSelectedContactId,
  ]);

  return {
    canRemoveContextMenuContact,
    closeContextMenu,
    contextMenu,
    handleAreaContextMenu,
    handleSidebarContextMenu,
    removeContextMenuContact,
  };
}

export function ContactsContextMenuLayer(params: {
  canRemoveContextMenuContact: boolean;
  closeContextMenu: () => void;
  contextMenu: ContactsContextMenuState | null;
  openImportContactRoute: () => void;
  openNewContactRoute: () => void;
  ready: boolean;
  removeContextMenuContact: () => Promise<void>;
}) {
  const {
    canRemoveContextMenuContact,
    closeContextMenu,
    contextMenu,
    openImportContactRoute,
    openNewContactRoute,
    ready,
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
      {contextMenu.id.kind === "area" ? (
        <>
          <MenuItem
            label={CONTACTS_LABELS.newContactAction}
            disabled={!ready}
            onClick={() => {
              closeContextMenu();
              openNewContactRoute();
            }}
          />
          <MenuItem
            label={CONTACTS_LABELS.importContactAction}
            disabled={!ready}
            onClick={() => {
              closeContextMenu();
              openImportContactRoute();
            }}
          />
        </>
      ) : (
        <MenuItem
          label="Remove"
          disabled={!canRemoveContextMenuContact}
          onClick={() => {
            void removeContextMenuContact();
          }}
        />
      )}
    </Menu>
  );
}
