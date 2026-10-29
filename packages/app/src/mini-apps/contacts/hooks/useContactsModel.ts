import { useCompactRoutedMode } from "@tearleads/windowing";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
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
import { useContactDrafts } from "./useContactDrafts";
import { useImportContactMessage } from "./useContactImport";
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

export function useContactsModel(setSidebar: (sidebar: ReactNode) => void) {
  const compactRoutedMode = useCompactRoutedMode();
  const appData = useTearleadsRuntime();
  const {
    createContact,
    canWrite,
    entries,
    importVerifiedUser,
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
    openImportContactRoute: routeState.openImportContactRoute,
    identityLinkToken: routeState.identityLinkToken,
    identityScope: `${appData.auth.userId}:${appData.crypto.signingFingerprint}:${appData.infra.dbId}`,
    canWrite,
    createContact,
    importVerifiedUser,
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
    ...routeState,
    blobStore: appData.infra.blobStore,
    canWrite,
    currentSigningFingerprint: appData.crypto.signingFingerprint,
    currentUserId: appData.auth.userId,
    entries,
    isAuthenticated,
    ready,
    removeContactAvatar,
    selectContact: selectionState.selectContact,
    selectedContactId: selectionState.selectedContactId,
    setContactAvatar,
    showCompactListHome:
      compactRoutedMode &&
      routeState.route === "selection" &&
      selectionState.selectedContactId === null,
    updateContact,
  };
}
