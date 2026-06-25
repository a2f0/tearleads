import type {
  OrganizationDirectory,
  OrganizationDirectoryUser,
} from "@tearleads/client-sdk";
import { useCallback, useRef, useState } from "react";
import type { OpenMiniAppRequest } from "../../types";
import type { OrgManagerContextMenuState } from "../context-menu/OrgManagerContextMenu";
import type { OrgManagerView } from "../routes";

interface OrgManagerRosterActionsInput {
  authUserId: string | null;
  contextMenu: OrgManagerContextMenuState | null;
  directory: OrganizationDirectory | null;
  openMiniApp: (request: OpenMiniAppRequest) => void;
  selectUser: (userId: string | null) => void;
  selectedRosterUser: Pick<OrganizationDirectoryUser, "userId"> | null;
  setOrgManagerView: (view: OrgManagerView) => void;
}

function contextMenuRosterUserId(
  contextMenu: OrgManagerContextMenuState | null,
) {
  return typeof contextMenu?.id === "object" &&
    contextMenu.id.kind === "directory-user"
    ? contextMenu.id.userId
    : null;
}

export function useOrgManagerRosterActions(
  input: OrgManagerRosterActionsInput,
) {
  const {
    authUserId,
    contextMenu,
    directory,
    openMiniApp,
    selectUser,
    selectedRosterUser,
    setOrgManagerView,
  } = input;
  const [rosterProfileEditRequest, setRosterProfileEditRequest] = useState<{
    key: number;
    userId: string;
  } | null>(null);
  const rosterProfileEditRequestKeyRef = useRef(0);

  const canUpdateRosterUser = useCallback(
    (userId: string) =>
      Boolean(directory?.currentUser.isOrgAdmin || userId === authUserId),
    [authUserId, directory?.currentUser.isOrgAdmin],
  );
  const contextMenuUserId = contextMenuRosterUserId(contextMenu);
  const canEditContextMenuRosterUser = Boolean(
    contextMenuUserId &&
      directory?.users.some((user) => user.userId === contextMenuUserId) &&
      canUpdateRosterUser(contextMenuUserId),
  );
  const canUpdateSelectedRosterEntry = Boolean(
    selectedRosterUser && canUpdateRosterUser(selectedRosterUser.userId),
  );

  const clearRosterProfileEditRequest = useCallback(() => {
    setRosterProfileEditRequest(null);
  }, []);

  const selectRosterUser = useCallback(
    (userId: string | null) => {
      clearRosterProfileEditRequest();
      selectUser(userId);
    },
    [clearRosterProfileEditRequest, selectUser],
  );

  const openRosterUser = useCallback(
    (userId: string) => {
      setOrgManagerView("directory");
      selectRosterUser(userId);
    },
    [selectRosterUser, setOrgManagerView],
  );

  const openRosterUserForEditing = useCallback(
    (userId: string) => {
      if (!canUpdateRosterUser(userId)) {
        return;
      }

      openRosterUser(userId);
      const nextKey = rosterProfileEditRequestKeyRef.current + 1;
      rosterProfileEditRequestKeyRef.current = nextKey;
      setRosterProfileEditRequest({ key: nextKey, userId });
    },
    [canUpdateRosterUser, openRosterUser],
  );

  const importRosterUserIntoContacts = useCallback(
    (userId: string) => {
      openMiniApp({
        appId: "contacts",
        message: {
          appId: "contacts",
          type: "import-contact",
          userId,
        },
        pathSegments: ["import"],
      });
    },
    [openMiniApp],
  );

  return {
    canEditContextMenuRosterUser,
    canUpdateSelectedRosterEntry,
    canUpdateRosterUser,
    clearRosterProfileEditRequest,
    importRosterUserIntoContacts,
    openRosterUser,
    openRosterUserForEditing,
    rosterProfileEditRequest,
    selectRosterUser,
  };
}
