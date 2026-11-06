import { useCallback, useReducer } from "react";
import type { OrgManagerView } from "../routes";
import {
  CLOSED_ORG_MANAGER_DIALOGS,
  orgManagerDialogDraft,
  transitionOrgManagerDialogs,
} from "./orgManagerDialogsMachine";

/**
 * The create-group and import-user dialogs (`orgManagerDialogsMachine`).
 * Each opens only when allowed and refuses to close while a mutation runs;
 * mutations and scope resets send their own events through
 * `sendDialogEvent`.
 */
export function useOrgManagerDialogs(params: {
  canCreateGroup: boolean;
  canImportRosterUser: boolean;
  mutating: boolean;
  selectGroup: (groupId: string | null) => void;
  setError: (error: string | null) => void;
  setOrgManagerView: (view: OrgManagerView) => void;
  setView: (view: OrgManagerView) => void;
}) {
  const {
    canCreateGroup,
    canImportRosterUser,
    mutating,
    selectGroup,
    setError,
    setOrgManagerView,
    setView,
  } = params;
  const [dialogs, sendDialogEvent] = useReducer(
    transitionOrgManagerDialogs,
    CLOSED_ORG_MANAGER_DIALOGS,
  );
  const openCreateGroupDialog = useCallback(() => {
    if (!canCreateGroup) {
      return;
    }

    setError(null);
    selectGroup(null);
    setView("groups");
    sendDialogEvent({ dialog: "createGroup", type: "open" });
  }, [canCreateGroup, selectGroup, setError, setView]);
  const closeCreateGroupDialog = useCallback(() => {
    if (mutating) {
      return;
    }

    setError(null);
    sendDialogEvent({ dialog: "createGroup", type: "close" });
  }, [mutating, setError]);
  const openImportUserDialog = useCallback(() => {
    if (!canImportRosterUser) {
      return;
    }

    setError(null);
    setOrgManagerView("directory");
    sendDialogEvent({ dialog: "importUser", type: "open" });
  }, [canImportRosterUser, setError, setOrgManagerView]);
  const closeImportUserDialog = useCallback(() => {
    if (mutating) {
      return;
    }

    setError(null);
    sendDialogEvent({ dialog: "importUser", type: "close" });
  }, [mutating, setError]);
  const setGroupNameDraft = useCallback((draft: string) => {
    sendDialogEvent({ dialog: "createGroup", draft, type: "editDraft" });
  }, []);
  const setImportUserIdDraft = useCallback((draft: string) => {
    sendDialogEvent({ dialog: "importUser", draft, type: "editDraft" });
  }, []);
  return {
    closeCreateGroupDialog,
    closeImportUserDialog,
    groupNameDraft: orgManagerDialogDraft(dialogs, "createGroup"),
    importUserIdDraft: orgManagerDialogDraft(dialogs, "importUser"),
    isCreateGroupDialogOpen: dialogs.status === "createGroup",
    isImportUserDialogOpen: dialogs.status === "importUser",
    openCreateGroupDialog,
    openImportUserDialog,
    sendDialogEvent,
    setGroupNameDraft,
    setImportUserIdDraft,
  };
}
