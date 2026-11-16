import { useCompactRoutedMode } from "@tearleads/windowing";
import { type ReactNode, useCallback } from "react";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import { useContacts } from "../../../stores/contacts/ContactsProvider";
import { useCurrentSelfContactIdentity } from "../../../stores/contacts/useCurrentSelfContactIdentity";
import { useContactsSidebarPanel } from "../ContactsSidebar";
import {
  type ContactsContextMenuModel,
  useContactsContextMenu,
} from "../context-menu/ContactsContextMenu";
import { useContactDrafts } from "./useContactDrafts";
import { useImportContactMessage } from "./useContactImport";
import { useContactsRouteState } from "./useContactsRouteState";
import { useSelectInitialSelfContact } from "./useSelectInitialSelfContact";

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

export function useContactsModel(setSidebar: (sidebar: ReactNode) => void) {
  const compactRoutedMode = useCompactRoutedMode();
  const appData = useTearleadsRuntime();
  const contacts = useContacts();
  const selfContactIdentity = useCurrentSelfContactIdentity();
  const { canWrite, entries, ready } = contacts;
  const { isAuthenticated } = useCryptoSession();
  const { logError } = useLog();
  const routeState = useContactsRouteState(compactRoutedMode);
  const selectionState = useContactsSelectionState(routeState);
  const drafts = useContactDrafts({
    openImportContactRoute: routeState.openImportContactRoute,
    identityLinkToken: routeState.identityLinkToken,
    identityScope: `${appData.auth.userId}:${appData.crypto.signingFingerprint}:${appData.infra.dbId}`,
    canWrite,
    createContact: contacts.createContact,
    importVerifiedUser: contacts.importVerifiedUser,
    isAuthenticated,
    logError,
    ready,
    setSelectedContactId: routeState.selectCreatedContactRoute,
  });

  const contextMenuState: ContactsContextMenuModel = useContactsContextMenu({
    canWrite,
    entries,
    removeContact: contacts.removeContact,
    selectedContactId: selectionState.selectedContactId,
    selfContactIdentity,
    setSelectedContactId: selectionState.setSelectedContactRouteAware,
  });

  useSelectInitialSelfContact({
    enabled: !compactRoutedMode,
    entries,
    hasRequestedRoute: routeState.hasRequestedRoute,
    ready,
    route: routeState.route,
    selectedContactId: selectionState.selectedContactId,
    selfContactIdentity,
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
    addressActions: {
      addContactAddress: contacts.addContactAddress,
      updateContactAddress: contacts.updateContactAddress,
      removeContactAddress: contacts.removeContactAddress,
    },
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
    removeContactAvatar: contacts.removeContactAvatar,
    selectContact: selectionState.selectContact,
    selectedContactId: selectionState.selectedContactId,
    setContactAvatar: contacts.setContactAvatar,
    showCompactListHome:
      compactRoutedMode &&
      routeState.route === "selection" &&
      selectionState.selectedContactId === null,
    updateContact: contacts.updateContact,
  };
}
