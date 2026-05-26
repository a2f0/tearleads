import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
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
  draftNickname: string;
  draftUserId: string;
  entries: ContactEntries;
  importDraftContact: () => Promise<void>;
  isAuthenticated: boolean;
  ready: boolean;
  selectedContactId: string | null;
  setDraftFirstName: Dispatch<SetStateAction<string>>;
  setDraftLastName: Dispatch<SetStateAction<string>>;
  setDraftNickname: Dispatch<SetStateAction<string>>;
  setDraftUserId: Dispatch<SetStateAction<string>>;
  updateContact: ReturnType<typeof useContacts>["updateContact"];
}

interface ContactDraftModel {
  canCreate: boolean;
  canImport: boolean;
  createDraftContact: () => Promise<void>;
  draftFirstName: string;
  draftLastName: string;
  draftNickname: string;
  draftUserId: string;
  importDraftContact: () => Promise<void>;
  setDraftFirstName: Dispatch<SetStateAction<string>>;
  setDraftLastName: Dispatch<SetStateAction<string>>;
  setDraftNickname: Dispatch<SetStateAction<string>>;
  setDraftUserId: Dispatch<SetStateAction<string>>;
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

function useContactDrafts(input: {
  createContact: ReturnType<typeof useContacts>["createContact"];
  importKey: ReturnType<typeof useContacts>["importKey"];
  isAuthenticated: boolean;
  ready: boolean;
  setSelectedContactId: (contactId: string) => void;
}): ContactDraftModel {
  const {
    createContact,
    importKey,
    isAuthenticated,
    ready,
    setSelectedContactId,
  } = input;
  const [draftFirstName, setDraftFirstName] = useState("");
  const [draftLastName, setDraftLastName] = useState("");
  const [draftNickname, setDraftNickname] = useState("");
  const [draftUserId, setDraftUserId] = useState("");
  const canCreate =
    ready &&
    (draftNickname.trim().length > 0 ||
      draftFirstName.trim().length > 0 ||
      draftLastName.trim().length > 0);
  const canImport = ready && isAuthenticated && draftUserId.trim().length > 0;
  const createDraftContact = useCallback(async () => {
    const contactId = await createContact({
      firstName: draftFirstName,
      lastName: draftLastName,
      nickname: draftNickname,
    });
    if (contactId) {
      setSelectedContactId(contactId);
      setDraftFirstName("");
      setDraftLastName("");
      setDraftNickname("");
    }
  }, [
    createContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    setSelectedContactId,
  ]);
  const importDraftContact = useCallback(async () => {
    const contactId = await importKey(draftUserId.trim());
    if (contactId) {
      setSelectedContactId(contactId);
      setDraftUserId("");
    }
  }, [draftUserId, importKey, setSelectedContactId]);

  return {
    canCreate,
    canImport,
    createDraftContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    draftUserId,
    importDraftContact,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
    setDraftUserId,
  };
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
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );
  const drafts = useContactDrafts({
    createContact,
    importKey,
    isAuthenticated,
    ready,
    setSelectedContactId,
  });

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
  usePeerUserIdDraft(peerUserId, drafts.setDraftUserId);

  useContactsSidebarPanel({
    entries,
    handleContextMenu: contextMenuState.handleSidebarContextMenu,
    ready,
    selectedContactId,
    setSelectedContactId,
    setSidebar,
  });

  return {
    canCreate: drafts.canCreate,
    canImport: drafts.canImport,
    contextMenuState,
    createDraftContact: drafts.createDraftContact,
    draftFirstName: drafts.draftFirstName,
    draftLastName: drafts.draftLastName,
    draftNickname: drafts.draftNickname,
    draftUserId: drafts.draftUserId,
    entries,
    importDraftContact: drafts.importDraftContact,
    isAuthenticated,
    ready,
    selectedContactId,
    setDraftFirstName: drafts.setDraftFirstName,
    setDraftLastName: drafts.setDraftLastName,
    setDraftNickname: drafts.setDraftNickname,
    setDraftUserId: drafts.setDraftUserId,
    updateContact,
  };
}
