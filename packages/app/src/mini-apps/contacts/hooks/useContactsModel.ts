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
import type { ContactsRoute } from "../routes";
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
  openImportContactRoute: () => void;
  openNewContactRoute: () => void;
  ready: boolean;
  route: ContactsRoute;
  selectedContactId: string | null;
  setDraftFirstName: Dispatch<SetStateAction<string>>;
  setDraftLastName: Dispatch<SetStateAction<string>>;
  setDraftNickname: Dispatch<SetStateAction<string>>;
  setDraftUserId: Dispatch<SetStateAction<string>>;
  showSelectionRoute: () => void;
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

function useContactsRouteState() {
  const [route, setRoute] = useState<ContactsRoute>("selection");
  const showSelectionRoute = useCallback(() => setRoute("selection"), []);
  const openNewContactRoute = useCallback(() => setRoute("new-contact"), []);
  const openImportContactRoute = useCallback(
    () => setRoute("import-contact"),
    [],
  );

  return {
    openImportContactRoute,
    openNewContactRoute,
    route,
    showSelectionRoute,
  };
}

function useContactsSelectionState(
  routeState: ReturnType<typeof useContactsRouteState>,
) {
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );
  const selectContact = useCallback(
    (contactId: string) => {
      setSelectedContactId(contactId);
      routeState.showSelectionRoute();
    },
    [routeState.showSelectionRoute],
  );
  const setSelectedContactRouteAware = useCallback(
    (contactId: string | null) => {
      setSelectedContactId(contactId);
      routeState.showSelectionRoute();
    },
    [routeState.showSelectionRoute],
  );

  return {
    selectContact,
    selectedContactId,
    setSelectedContactId,
    setSelectedContactRouteAware,
  };
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
  openImportContactRoute: () => void,
  peerUserId: string | null,
  setDraftUserId: (setter: (currentId: string) => string) => void,
) {
  useEffect(() => {
    if (peerUserId) {
      openImportContactRoute();
      setDraftUserId((currentId) => (currentId ? currentId : peerUserId));
    }
  }, [openImportContactRoute, peerUserId, setDraftUserId]);
}

function useContactDrafts(input: {
  createContact: ReturnType<typeof useContacts>["createContact"];
  importKey: ReturnType<typeof useContacts>["importKey"];
  isAuthenticated: boolean;
  logError: ReturnType<typeof useLog>["logError"];
  ready: boolean;
  setSelectedContactId: (contactId: string) => void;
}): ContactDraftModel {
  const {
    createContact,
    importKey,
    isAuthenticated,
    logError,
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
    if (!canCreate) {
      return;
    }

    try {
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
    } catch (error: unknown) {
      logError("Contacts: failed to create contact.", error);
    }
  }, [
    canCreate,
    createContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    logError,
    setSelectedContactId,
  ]);
  const importDraftContact = useCallback(async () => {
    if (!canImport) {
      return;
    }

    try {
      const contactId = await importKey(draftUserId.trim());
      if (contactId) {
        setSelectedContactId(contactId);
        setDraftUserId("");
      }
    } catch (error: unknown) {
      logError("Contacts: failed to import contact.", error);
    }
  }, [canImport, draftUserId, importKey, logError, setSelectedContactId]);

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
  const routeState = useContactsRouteState();
  const selectionState = useContactsSelectionState(routeState);
  const drafts = useContactDrafts({
    createContact,
    importKey,
    isAuthenticated,
    logError,
    ready,
    setSelectedContactId: selectionState.selectContact,
  });

  const contextMenuState = useContactsContextMenu({
    entries,
    removeContact,
    selectedContactId: selectionState.selectedContactId,
    setSelectedContactId: selectionState.setSelectedContactRouteAware,
  });

  useAutoImportSelfContact({
    entries,
    importKey,
    isAuthenticated,
    logError,
    ready,
    sessionUserId,
    setSelectedContactId: selectionState.setSelectedContactId,
  });
  usePeerUserIdDraft(
    routeState.openImportContactRoute,
    peerUserId,
    drafts.setDraftUserId,
  );

  useContactsSidebarPanel({
    entries,
    handleContextMenu: contextMenuState.handleSidebarContextMenu,
    ready,
    selectedContactId: selectionState.selectedContactId,
    setSelectedContactId: selectionState.selectContact,
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
    openImportContactRoute: routeState.openImportContactRoute,
    openNewContactRoute: routeState.openNewContactRoute,
    ready,
    route: routeState.route,
    selectedContactId: selectionState.selectedContactId,
    setDraftFirstName: drafts.setDraftFirstName,
    setDraftLastName: drafts.setDraftLastName,
    setDraftNickname: drafts.setDraftNickname,
    setDraftUserId: drafts.setDraftUserId,
    showSelectionRoute: routeState.showSelectionRoute,
    updateContact,
  };
}
