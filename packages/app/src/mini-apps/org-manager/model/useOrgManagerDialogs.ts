import { useCallback, useState } from "react";
import type { OrgManagerView } from "../routes";

/**
 * The create-group and import-user dialogs: their open flags and drafts.
 * Each opens only when allowed and refuses to close while a mutation runs.
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
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false);
  const [importUserIdDraft, setImportUserIdDraft] = useState("");
  const [isImportUserDialogOpen, setIsImportUserDialogOpen] = useState(false);
  const openCreateGroupDialog = useCallback(() => {
    if (!canCreateGroup) {
      return;
    }

    setError(null);
    setGroupNameDraft("");
    selectGroup(null);
    setView("groups");
    setIsCreateGroupDialogOpen(true);
  }, [canCreateGroup, selectGroup, setView]);
  const closeCreateGroupDialog = useCallback(() => {
    if (mutating) {
      return;
    }

    setError(null);
    setGroupNameDraft("");
    setIsCreateGroupDialogOpen(false);
  }, [mutating]);
  const openImportUserDialog = useCallback(() => {
    if (!canImportRosterUser) {
      return;
    }

    setError(null);
    setImportUserIdDraft("");
    setOrgManagerView("directory");
    setIsImportUserDialogOpen(true);
  }, [canImportRosterUser, setOrgManagerView]);
  const closeImportUserDialog = useCallback(() => {
    if (mutating) {
      return;
    }

    setError(null);
    setImportUserIdDraft("");
    setIsImportUserDialogOpen(false);
  }, [mutating]);
  return {
    closeCreateGroupDialog,
    closeImportUserDialog,
    groupNameDraft,
    importUserIdDraft,
    isCreateGroupDialogOpen,
    isImportUserDialogOpen,
    openCreateGroupDialog,
    openImportUserDialog,
    setGroupNameDraft,
    setImportUserIdDraft,
    setIsCreateGroupDialogOpen,
    setIsImportUserDialogOpen,
  };
}
