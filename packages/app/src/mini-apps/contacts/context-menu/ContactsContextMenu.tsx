import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { UserMinusIcon } from "@phosphor-icons/react/dist/csr/UserMinus";
import { type ContextMenuState, Menu, MenuItem } from "@tearleads/windowing";
import { type MouseEvent, useCallback, useMemo } from "react";
import { CopyIdentityLinkMenuItem } from "../../../components/identity/CopyIdentityLinkMenuItem";
import {
  matchesSelfContactIdentity,
  type SelfContactIdentityView,
  selfContactIdentityAdmission,
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
  canEditContextMenuContact: boolean;
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
  const canEditContextMenuContact =
    contextMenuEntry !== undefined && contextMenuEntry.canWrite !== false;
  // `absent` (no signing identity) has no Me to protect from removal.
  const canRemoveContextMenuContact = Boolean(
    canWrite &&
      canEditContextMenuContact &&
      selfContactIdentityAdmission(selfContactIdentity) !== null &&
      !(
        selfContactIdentity.status === "ready" &&
        matchesSelfContactIdentity(
          selfContactIdentity.identity,
          contextMenuEntry,
        )
      ),
  );

  const removeContextMenuContact = useCallback(async () => {
    const admission = selfContactIdentityAdmission(selfContactIdentity);
    if (
      contextMenu?.id.kind !== "contact" ||
      !canRemoveContextMenuContact ||
      !admission
    ) {
      return;
    }

    const contactId = contextMenu.id.contactId;
    closeContextMenu();
    if (selectedContactId === contactId) {
      setSelectedContactId(null);
    }
    await admission.runWhenCurrent(() =>
      removeContact(contactId, {
        isCurrent: admission.isCurrent,
        runWhenCurrent: admission.runWhenCurrent,
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
    canEditContextMenuContact,
    canRemoveContextMenuContact,
    closeContextMenu,
    contextMenuContactUserId: contextMenuEntry?.userId ?? null,
    contextMenu,
    handleAreaContextMenu,
    handleSidebarContextMenu,
    removeContextMenuContact,
  };
}

export function ContactsContextMenuLayer(params: {
  editContact: (contactId: string) => void;
  canEditContextMenuContact: boolean;
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

  const target = contextMenu.id;
  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      {target.kind === "area" ? (
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
          <MenuItem
            icon={PencilSimpleIcon}
            label={CONTACTS_LABELS.editAction}
            disabled={!ready || !params.canEditContextMenuContact}
            onClick={() => {
              closeContextMenu();
              params.editContact(target.contactId);
            }}
          />
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
