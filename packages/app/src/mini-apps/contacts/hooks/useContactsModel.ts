import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useCompactRoutedMode } from "../../../navigation/useCompactRoutedMode";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import { useContacts } from "../../../stores/contacts/ContactsProvider";
import { useContactsSidebarPanel } from "../ContactsSidebar";
import {
  type ContactsContextMenuModel,
  useContactsContextMenu,
} from "../context-menu/ContactsContextMenu";
import type { ContactsRoute } from "../routes";
import type { ContactEntries } from "../types";
import {
  useImportContactByUserId,
  useImportContactMessage,
} from "./useContactImport";
import { useContactsRouteState } from "./useContactsRouteState";

function useContactsSelectionState(
  routeState: ReturnType<typeof useContactsRouteState>,
) {
  const { selectContactRoute, showSelectionRoute } = routeState;
  const setSelectedContactRouteAware = useCallback(
    (contactId: string | null) => {
      if (contactId) {
        selectContactRoute(contactId);
        return;
      }

      showSelectionRoute();
    },
    [selectContactRoute, showSelectionRoute],
  );
  const setSelectedContactId = useCallback(
    (contactId: string) => selectContactRoute(contactId, { replace: true }),
    [selectContactRoute],
  );

  return {
    selectContact: selectContactRoute,
    selectedContactId: routeState.selectedContactId,
    setSelectedContactId,
    setSelectedContactRouteAware,
  };
}

function useSelectInitialSelfContact(input: {
  enabled: boolean;
  entries: ContactEntries;
  ready: boolean;
  route: ContactsRoute;
  selectedContactId: string | null;
  setSelectedContactId: (contactId: string) => void;
}) {
  const {
    enabled,
    entries,
    ready,
    route,
    selectedContactId,
    setSelectedContactId,
  } = input;
  const selectedInitialSelfRef = useRef(false);

  useEffect(() => {
    if (
      !enabled ||
      !ready ||
      route !== "selection" ||
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
  }, [enabled, entries, ready, route, selectedContactId, setSelectedContactId]);
}

function hasContactNameDraft(params: {
  firstName: string;
  lastName: string;
  nickname: string;
}): boolean {
  return (
    params.nickname.trim().length > 0 ||
    params.firstName.trim().length > 0 ||
    params.lastName.trim().length > 0
  );
}

function useCreateDraftContact(input: {
  canCreate: boolean;
  createContact: ReturnType<typeof useContacts>["createContact"];
  draftFirstName: string;
  draftLastName: string;
  draftNickname: string;
  isSubmittingRef: { current: boolean };
  logError: ReturnType<typeof useLog>["logError"];
  setDraftFirstName: Dispatch<SetStateAction<string>>;
  setDraftLastName: Dispatch<SetStateAction<string>>;
  setDraftNickname: Dispatch<SetStateAction<string>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setSelectedContactId: (contactId: string) => void;
}) {
  const {
    canCreate,
    createContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    isSubmittingRef,
    logError,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
    setIsSubmitting,
    setSelectedContactId,
  } = input;

  return useCallback(async () => {
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
    isSubmittingRef,
    logError,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
    setIsSubmitting,
    setSelectedContactId,
  ]);
}

function useContactDrafts(input: {
  canWrite: boolean;
  createContact: ReturnType<typeof useContacts>["createContact"];
  importKey: ReturnType<typeof useContacts>["importKey"];
  isAuthenticated: boolean;
  logError: ReturnType<typeof useLog>["logError"];
  ready: boolean;
  setSelectedContactId: (contactId: string) => void;
}) {
  const {
    canWrite,
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
    canWrite &&
    ready &&
    hasContactNameDraft({
      firstName: draftFirstName,
      lastName: draftLastName,
      nickname: draftNickname,
    });
  const isImportReady = canWrite && ready && isAuthenticated;
  const canImport =
    !isSubmitting && isImportReady && draftUserId.trim().length > 0;

  const createDraftContact = useCreateDraftContact({
    canCreate,
    createContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    isSubmittingRef,
    logError,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
    setIsSubmitting,
    setSelectedContactId,
  });
  const importContactByUserId = useImportContactByUserId({
    importKey,
    isImportReady,
    isSubmittingRef,
    logError,
    setIsSubmitting,
    setSelectedContactId,
  });
  const importDraftContact = useCallback(async () => {
    const contactId = await importContactByUserId(draftUserId);
    if (contactId) {
      setDraftUserId("");
    }
  }, [draftUserId, importContactByUserId, setDraftUserId]);

  return {
    canCreate,
    canImport,
    createDraftContact,
    draftFirstName,
    draftLastName,
    draftNickname,
    draftUserId,
    importContactByUserId,
    importDraftContact,
    isImportReady,
    isSubmitting,
    setDraftFirstName,
    setDraftLastName,
    setDraftNickname,
    setDraftUserId,
  };
}

export function useContactsModel(setSidebar: (sidebar: ReactNode) => void) {
  const compactRoutedMode = useCompactRoutedMode();
  const appData = useTearleadsRuntime();
  const {
    createContact,
    canWrite,
    entries,
    importKey,
    ready,
    removeContact,
    removeContactAvatar,
    setContactAvatar,
    updateContact,
  } = useContacts();
  const { isAuthenticated } = useCryptoSession();
  const { logError } = useLog();
  const routeState = useContactsRouteState(compactRoutedMode);
  const selectionState = useContactsSelectionState(routeState);
  const drafts = useContactDrafts({
    canWrite,
    createContact,
    importKey,
    isAuthenticated,
    logError,
    ready,
    setSelectedContactId: routeState.selectCreatedContactRoute,
  });

  const contextMenuState: ContactsContextMenuModel = useContactsContextMenu({
    canWrite,
    entries,
    removeContact,
    selectedContactId: selectionState.selectedContactId,
    setSelectedContactId: selectionState.setSelectedContactRouteAware,
  });

  useSelectInitialSelfContact({
    enabled: !compactRoutedMode,
    entries,
    ready,
    route: routeState.route,
    selectedContactId: selectionState.selectedContactId,
    setSelectedContactId: selectionState.setSelectedContactId,
  });
  useImportContactMessage({
    importContactByUserId: drafts.importContactByUserId,
    isImportReady: drafts.isImportReady,
    isSubmitting: drafts.isSubmitting,
  });

  useContactsSidebarPanel({
    blobStore: appData.infra.blobStore,
    currentSigningFingerprint: appData.crypto.signingFingerprint,
    currentUserId: appData.auth.userId,
    entries,
    handleAreaContextMenu: contextMenuState.handleAreaContextMenu,
    handleContextMenu: contextMenuState.handleSidebarContextMenu,
    ready,
    selectedContactId: selectionState.selectedContactId,
    setSelectedContactId: selectionState.selectContact,
    setSidebar,
  });

  return {
    contextMenuState,
    ...drafts,
    blobStore: appData.infra.blobStore,
    canWrite,
    currentSigningFingerprint: appData.crypto.signingFingerprint,
    currentUserId: appData.auth.userId,
    entries,
    isAuthenticated,
    openImportContactRoute: routeState.openImportContactRoute,
    openNewContactRoute: routeState.openNewContactRoute,
    ready,
    removeContactAvatar,
    route: routeState.route,
    selectContact: selectionState.selectContact,
    selectedContactId: selectionState.selectedContactId,
    setContactAvatar,
    showCompactListHome:
      compactRoutedMode &&
      routeState.route === "selection" &&
      selectionState.selectedContactId === null,
    showSelectionRoute: routeState.showSelectionRoute,
    updateContact,
  };
}
