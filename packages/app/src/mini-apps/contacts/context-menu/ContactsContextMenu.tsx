import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { UserMinusIcon } from "@phosphor-icons/react/dist/csr/UserMinus";
import { type ContextMenuState, Menu, MenuItem } from "@tearleads/windowing";
import { type MouseEvent, useCallback, useMemo } from "react";
import { CopyIdentityLinkMenuItem } from "../../../components/identity/CopyIdentityLinkMenuItem";
import {
  matchesSelfContactIdentity,
  type SelfContactIdentityView,
} from "../../../stores/contacts/currentSelfContactIdentityState";
import type { ContactsContextValue } from "../../../stores/contacts/types";
import { useMiniAppListContextMenu } from "../../shared/list-panel/useMiniAppListContextMenu";
import { NewContactIcon } from "../../shared/newContactIcon";
import { CONTACTS_LABELS } from "../labels";
import type { ContactEntries } from "../types";

export type ContactsContextMenuTarget =
  | { kind: "area" }
  | { contactId: string; kind: "contact" };

export type ContactsContextMenuState =
  ContextMenuState<ContactsContextMenuTarget>;

const AREA_TARGET: ContactsContextMenuTarget = { kind: "area" };

function contactTarget(contactId: string): ContactsContextMenuTarget {
  return { contactId, kind: "contact" };
}

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
  removeContact: ContactsContextValue["removeContact"];
  selectedContactId: string | null;
  selfContactIdentity: SelfContactIdentityView;
  setSelectedContactId: (contactId: string | null) => void;
}): ContactsContextMenuModel {
  const {
    canWrite,
    entries,
    removeContact,
    selectedContactId,
    selfContactIdentity,
    setSelectedContactId,
  } = params;
  const {
    closeContextMenu,
    contextMenu,
    handleAreaContextMenu,
    handleRowContextMenu: handleSidebarContextMenu,
  } = useMiniAppListContextMenu({
    areaTarget: AREA_TARGET,
    rowTarget: contactTarget,
  });
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
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
      selfContactIdentity.status === "ready" &&
      selfContactIdentity.isCurrent() &&
      !matchesSelfContactIdentity(
        selfContactIdentity.identity,
        contextMenuEntry,
      ),
  );
  const contextMenuContactUserId =
    contextMenu?.id.kind === "contact"
      ? (contextMenuEntry?.userId ?? null)
      : null;

  const removeContextMenuContact = useCallback(async () => {
    if (
      contextMenu?.id.kind !== "contact" ||
      !canRemoveContextMenuContact ||
      selfContactIdentity.status !== "ready" ||
      !selfContactIdentity.isCurrent()
    ) {
      return;
    }

    const contactId = contextMenu.id.contactId;
    closeContextMenu();
    if (selectedContactId === contactId) {
      setSelectedContactId(null);
    }
    await selfContactIdentity.runWhenCurrent(() =>
      removeContact(contactId, {
        isCurrent: selfContactIdentity.isCurrent,
        runWhenCurrent: selfContactIdentity.runWhenCurrent,
      }),
    );
  }, [
    closeContextMenu,
    canRemoveContextMenuContact,
    contextMenu,
    removeContact,
    selectedContactId,
    selfContactIdentity,
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
          <CopyIdentityLinkMenuItem
            onSelect={closeContextMenu}
            userId={contextMenuContactUserId}
          />
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
