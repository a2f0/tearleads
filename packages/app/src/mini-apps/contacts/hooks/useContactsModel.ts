import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMiniAppRouteSegments } from "../../../navigation/AppNavigationProvider";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { useContacts } from "../../../stores/contacts/ContactsProvider";
import { useContactsSidebarPanel } from "../ContactsSidebar";
import {
  type ContactsContextMenuModel,
  useContactsContextMenu,
} from "../context-menu/ContactsContextMenu";
import {
  type ContactsRoute,
  type ContactsRouteSnapshot,
  DEFAULT_CONTACTS_ROUTE_SNAPSHOT,
  formatContactsRouteSegments,
  parseContactsRouteSegments,
} from "../routes";
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
  const { isRouted, pathSegments, setPathSegments } =
    useMiniAppRouteSegments("contacts");
  const [localRoute, setLocalRoute] = useState<ContactsRouteSnapshot>(
    DEFAULT_CONTACTS_ROUTE_SNAPSHOT,
  );
  const routeSnapshot = isRouted
    ? parseContactsRouteSegments(pathSegments)
    : localRoute;
  const setRouteSnapshot = useCallback(
    (
      nextRoute: ContactsRouteSnapshot,
      options: { replace?: boolean | undefined } = {},
    ) => {
      if (isRouted) {
        setPathSegments(formatContactsRouteSegments(nextRoute), options);
        return;
      }

      setLocalRoute(nextRoute);
    },
    [isRouted, setPathSegments],
  );
  const showSelectionRoute = useCallback(
    () =>
      setRouteSnapshot({
        route: "selection",
        selectedContactId: routeSnapshot.selectedContactId,
      }),
    [routeSnapshot.selectedContactId, setRouteSnapshot],
  );
  const openNewContactRoute = useCallback(
    () => setRouteSnapshot({ route: "new-contact", selectedContactId: null }),
    [setRouteSnapshot],
  );
  const openImportContactRoute = useCallback(
    () =>
      setRouteSnapshot({ route: "import-contact", selectedContactId: null }),
    [setRouteSnapshot],
  );
  const selectContactRoute = useCallback(
    (contactId: string, options: { replace?: boolean | undefined } = {}) =>
      setRouteSnapshot(
        { route: "selection", selectedContactId: contactId },
        options,
      ),
    [setRouteSnapshot],
  );

  return {
    openImportContactRoute,
    openNewContactRoute,
    route: routeSnapshot.route,
    selectContactRoute,
    selectedContactId: routeSnapshot.selectedContactId,
    showSelectionRoute,
  };
}

function useContactsSelectionState(
  routeState: ReturnType<typeof useContactsRouteState>,
) {
  const selectContact = useCallback(
    (contactId: string) => {
      routeState.selectContactRoute(contactId);
    },
    [routeState.selectContactRoute],
  );
  const setSelectedContactRouteAware = useCallback(
    (contactId: string | null) => {
      if (contactId) {
        routeState.selectContactRoute(contactId);
        return;
      }

      routeState.showSelectionRoute();
    },
    [routeState.selectContactRoute, routeState.showSelectionRoute],
  );
  const setSelectedContactId = useCallback(
    (contactId: string) => {
      routeState.selectContactRoute(contactId, { replace: true });
    },
    [routeState.selectContactRoute],
  );

  return {
    selectContact,
    selectedContactId: routeState.selectedContactId,
    setSelectedContactId,
    setSelectedContactRouteAware,
  };
}

function useSelectInitialSelfContact(input: {
  entries: ContactEntries;
  ready: boolean;
  selectedContactId: string | null;
  setSelectedContactId: (contactId: string) => void;
}) {
  const { entries, ready, selectedContactId, setSelectedContactId } = input;
  const selectedInitialSelfRef = useRef(false);

  useEffect(() => {
    if (
      !ready ||
      selectedInitialSelfRef.current ||
      selectedContactId !== null
    ) {
      return;
    }

    const selfEntry = entries.find((entry) => entry.isSelf);
    if (!selfEntry) {
      return;
    }

    selectedInitialSelfRef.current = true;
    setSelectedContactId(selfEntry.id);
  }, [entries, ready, selectedContactId, setSelectedContactId]);
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const canCreate =
    !isSubmitting &&
    ready &&
    (draftNickname.trim().length > 0 ||
      draftFirstName.trim().length > 0 ||
      draftLastName.trim().length > 0);
  const canImport =
    !isSubmitting && ready && isAuthenticated && draftUserId.trim().length > 0;
  const createDraftContact = useCallback(async () => {
    if (!canCreate || isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
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
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
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
    if (!canImport || isSubmittingRef.current) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const contactId = await importKey(draftUserId.trim());
      if (contactId) {
        setSelectedContactId(contactId);
        setDraftUserId("");
      }
    } catch (error: unknown) {
      logError("Contacts: failed to import contact.", error);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
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
  const { isAuthenticated } = useCryptoSession();
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

  useSelectInitialSelfContact({
    entries,
    ready,
    selectedContactId: selectionState.selectedContactId,
    setSelectedContactId: selectionState.setSelectedContactId,
  });
  usePeerUserIdDraft(
    routeState.openImportContactRoute,
    peerUserId,
    drafts.setDraftUserId,
  );

  useContactsSidebarPanel({
    entries,
    handleAreaContextMenu: contextMenuState.handleAreaContextMenu,
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
