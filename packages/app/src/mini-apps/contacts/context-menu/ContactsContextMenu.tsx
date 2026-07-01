import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { UserMinusIcon } from "@phosphor-icons/react/dist/csr/UserMinus";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
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
      contextMenuEntry?.canWrite !== false &&
      !contextMenuEntry.isSelf,
  );

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
            icon={AddressBookIcon}
            label={CONTACTS_LABELS.newContactAction}
            disabled={!ready || !canWrite}
            onClick={() => {
              closeContextMenu();
              openNewContactRoute();
            }}
          />
          <MenuItem
            icon={UserPlusIcon}
            label={CONTACTS_LABELS.importContactAction}
            disabled={!ready || !canWrite}
            onClick={() => {
              closeContextMenu();
              openImportContactRoute();
            }}
          />
        </>
      ) : (
        <MenuItem
          icon={UserMinusIcon}
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
