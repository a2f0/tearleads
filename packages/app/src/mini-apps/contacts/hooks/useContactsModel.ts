import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { useContacts } from "../../../stores/contacts/ContactsProvider";
import { useContactsSidebarPanel } from "../ContactsSidebar";
import {
  type ContactsContextMenuModel,
  useContactsContextMenu,
} from "../context-menu/ContactsContextMenu";
import type { ContactEntries } from "../types";

interface ContactsModel {
  canCreate: boolean;
  canImport: boolean;
  contextMenuState: ContactsContextMenuModel;
  createDraftContact: () => Promise<void>;
  draftFirstName: string;
  draftLastName: string;
  draftUserId: string;
  entries: ContactEntries;
  importDraftContact: () => Promise<void>;
  isAuthenticated: boolean;
  ready: boolean;
  selectedContactId: string | null;
  setDraftFirstName: (firstName: string) => void;
  setDraftLastName: (lastName: string) => void;
  setDraftUserId: (userId: string) => void;
  updateContact: ReturnType<typeof useContacts>["updateContact"];
}

function useAutoImportSelfContact(input: {
  entries: ContactEntries;
  importKey: ReturnType<typeof useContacts>["importKey"];
  isAuthenticated: boolean;
  logError: ReturnType<typeof useLog>["logError"];
  ready: boolean;
  sessionUserId: string | null;
  setSelectedContactId: (setter: (currentId: string | null) => string) => void;
}) {
  const {
    entries,
    importKey,
    isAuthenticated,
    logError,
    ready,
    sessionUserId,
    setSelectedContactId,
  } = input;
  const selfImportedRef = useRef(false);

  useEffect(() => {
    if (
      ready &&
      isAuthenticated &&
      sessionUserId &&
      !selfImportedRef.current &&
      !entries.some((entry) => entry.isSelf || entry.userId === sessionUserId)
    ) {
      selfImportedRef.current = true;
      void importKey(sessionUserId)
        .then((contactId) => {
          if (contactId) {
            setSelectedContactId((currentId) => currentId ?? contactId);
          }
        })
        .catch((error: unknown) => {
          logError("Contacts: failed to auto-import self key.", error);
        });
    }
  }, [
    entries,
    importKey,
    isAuthenticated,
    logError,
    ready,
    sessionUserId,
    setSelectedContactId,
  ]);
}

function usePeerUserIdDraft(
  peerUserId: string | null,
  setDraftUserId: (setter: (currentId: string) => string) => void,
) {
  useEffect(() => {
    if (peerUserId) {
      setDraftUserId((currentId) => (currentId ? currentId : peerUserId));
    }
  }, [peerUserId, setDraftUserId]);
}

export function useContactsModel(
  setSidebar: (sidebar: ReactNode) => void,
  peerUserId: string | null,
): ContactsModel {
  const {
    createContact,
    entries,
    importKey,
    ready,
    removeContact,
    updateContact,
  } = useContacts();
  const { isAuthenticated, userId: sessionUserId } = useCryptoSession();
  const { logError } = useLog();
  const [draftFirstName, setDraftFirstName] = useState("");
  const [draftLastName, setDraftLastName] = useState("");
  const [draftUserId, setDraftUserId] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );

  const contextMenuState = useContactsContextMenu({
    entries,
    removeContact,
    selectedContactId,
    setSelectedContactId,
  });

  useAutoImportSelfContact({
    entries,
    importKey,
    isAuthenticated,
    logError,
    ready,
    sessionUserId,
    setSelectedContactId,
  });
  usePeerUserIdDraft(peerUserId, setDraftUserId);

  useContactsSidebarPanel({
    entries,
    handleContextMenu: contextMenuState.handleSidebarContextMenu,
    ready,
    selectedContactId,
    setSelectedContactId,
    setSidebar,
  });

  const canCreate =
    ready &&
    (draftFirstName.trim().length > 0 || draftLastName.trim().length > 0);
  const canImport = ready && isAuthenticated && draftUserId.trim().length > 0;
  const createDraftContact = useCallback(async () => {
    const contactId = await createContact({
      firstName: draftFirstName,
      lastName: draftLastName,
    });
    if (contactId) {
      setSelectedContactId(contactId);
      setDraftFirstName("");
      setDraftLastName("");
    }
  }, [createContact, draftFirstName, draftLastName]);
  const importDraftContact = useCallback(async () => {
    const contactId = await importKey(draftUserId.trim());
    if (contactId) {
      setSelectedContactId(contactId);
      setDraftUserId("");
    }
  }, [draftUserId, importKey]);

  return {
    canCreate,
    canImport,
    contextMenuState,
    createDraftContact,
    draftFirstName,
    draftLastName,
    draftUserId,
    entries,
    importDraftContact,
    isAuthenticated,
    ready,
    selectedContactId,
    setDraftFirstName,
    setDraftLastName,
    setDraftUserId,
    updateContact,
  };
}
