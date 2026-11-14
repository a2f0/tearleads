import { useCompactRoutedMode } from "@tearleads/windowing";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useCryptoSession } from "../../../providers/crypto/CryptoSessionProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import { useContacts } from "../../../stores/contacts/ContactsProvider";
import { findCurrentSelfContactLocalId } from "../../../stores/contacts/contactLabels";
import type { SelfContactIdentityView } from "../../../stores/contacts/currentSelfContactIdentityState";
import { useCurrentSelfContactIdentity } from "../../../stores/contacts/useCurrentSelfContactIdentity";
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
  selfContactIdentity: SelfContactIdentityView;
  setSelectedContactId: (contactId: string) => void;
}) {
  const {
    enabled,
    entries,
    ready,
    route,
    selectedContactId,
    selfContactIdentity,
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

    const selfId = findCurrentSelfContactLocalId(entries, selfContactIdentity);
    if (!selfId) {
      return;
    }
    selectedInitialSelfRef.current = true;
    setSelectedContactId(selfId);
  }, [
    enabled,
    entries,
    ready,
    route,
    selectedContactId,
    selfContactIdentity,
    setSelectedContactId,
  ]);
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
