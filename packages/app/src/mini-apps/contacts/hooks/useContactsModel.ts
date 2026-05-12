import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useContacts } from "../../../stores/contacts/ContactsProvider";
import { useContactsSidebarPanel } from "../ContactsSidebar";
import {
  type ContactsContextMenuModel,
  useContactsContextMenu,
} from "../context-menu/ContactsContextMenu";
import type { ContactEntries } from "../types";

interface ContactsModel {
  canImport: boolean;
  contextMenuState: ContactsContextMenuModel;
  draftUserId: string;
  entries: ContactEntries;
  importDraftContact: () => Promise<void>;
  isAuthenticated: boolean;
  ready: boolean;
  selectedUserId: string | null;
  setDraftUserId: (userId: string) => void;
}

export function useContactsModel(
  setSidebar: (sidebar: ReactNode) => void,
  peerUserId: string | null,
): ContactsModel {
  const { entries, importKey, ready, removeKey } = useContacts();
  const { isAuthenticated, userId: sessionUserId } = useCryptoSession();
  const [draftUserId, setDraftUserId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const selfImportedRef = useRef(false);

  const contextMenuState = useContactsContextMenu({
    entries,
    removeKey,
    selectedUserId,
    setSelectedUserId,
  });

  useEffect(() => {
    if (
      ready &&
      isAuthenticated &&
      sessionUserId &&
      !selfImportedRef.current &&
      !entries.some((entry) => entry.isSelf || entry.userId === sessionUserId)
    ) {
      selfImportedRef.current = true;
      void importKey(sessionUserId);
    }
  }, [ready, isAuthenticated, sessionUserId, entries, importKey]);

  useEffect(() => {
    if (peerUserId) {
      setDraftUserId((currentId) => (currentId ? currentId : peerUserId));
    }
  }, [peerUserId]);

  useContactsSidebarPanel({
    entries,
    handleContextMenu: contextMenuState.handleSidebarContextMenu,
    ready,
    selectedUserId,
    setSelectedUserId,
    setSidebar,
  });

  const canImport = ready && isAuthenticated && draftUserId.trim().length > 0;
  const importDraftContact = useCallback(async () => {
    await importKey(draftUserId.trim());
  }, [draftUserId, importKey]);

  return {
    canImport,
    contextMenuState,
    draftUserId,
    entries,
    importDraftContact,
    isAuthenticated,
    ready,
    selectedUserId,
    setDraftUserId,
  };
}
