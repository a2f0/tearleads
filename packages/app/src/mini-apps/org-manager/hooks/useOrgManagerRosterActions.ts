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
  canDisableRosterUsers: boolean;
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

function useRosterProfileEditRequest() {
  const [rosterProfileEditRequest, setRosterProfileEditRequest] = useState<{
    key: number;
    userId: string;
  } | null>(null);
  const rosterProfileEditRequestKeyRef = useRef(0);

  const clearRosterProfileEditRequest = useCallback(() => {
    setRosterProfileEditRequest(null);
  }, []);

  const requestRosterProfileEdit = useCallback((userId: string) => {
    const nextKey = rosterProfileEditRequestKeyRef.current + 1;
    rosterProfileEditRequestKeyRef.current = nextKey;
    setRosterProfileEditRequest({ key: nextKey, userId });
  }, []);

  return {
    clearRosterProfileEditRequest,
    requestRosterProfileEdit,
    rosterProfileEditRequest,
  };
}

function useRosterActionPermissions(
  input: Pick<
    OrgManagerRosterActionsInput,
    | "authUserId"
    | "canDisableRosterUsers"
    | "contextMenu"
    | "directory"
    | "selectedRosterUser"
  >,
) {
  const {
    authUserId,
    canDisableRosterUsers,
    contextMenu,
    directory,
    selectedRosterUser,
  } = input;
  const canUpdateRosterUser = useCallback(
    (userId: string) =>
      Boolean(directory?.currentUser.isOrgAdmin || userId === authUserId),
    [authUserId, directory?.currentUser.isOrgAdmin],
  );
  const canDisableRosterUser = useCallback(
    (userId: string) => {
      const user =
        directory?.users.find(
          (directoryUser) => directoryUser.userId === userId,
        ) ?? null;

      return Boolean(
        canDisableRosterUsers &&
          user &&
          user.status === "active" &&
          !user.isSelf &&
          user.userId !== authUserId,
      );
    },
    [authUserId, canDisableRosterUsers, directory?.users],
  );
  const contextMenuUserId = contextMenuRosterUserId(contextMenu);

  return {
    canDisableContextMenuRosterUser: Boolean(
      contextMenuUserId && canDisableRosterUser(contextMenuUserId),
    ),
    canEditContextMenuRosterUser: Boolean(
      contextMenuUserId &&
        directory?.users.some((user) => user.userId === contextMenuUserId) &&
        canUpdateRosterUser(contextMenuUserId),
    ),
    canUpdateRosterUser,
    canUpdateSelectedRosterEntry: Boolean(
      selectedRosterUser && canUpdateRosterUser(selectedRosterUser.userId),
    ),
  };
}

export function useOrgManagerRosterActions(
  input: OrgManagerRosterActionsInput,
) {
  const {
    authUserId,
    canDisableRosterUsers,
    contextMenu,
    directory,
    openMiniApp,
    selectUser,
    selectedRosterUser,
    setOrgManagerView,
  } = input;
  const {
    clearRosterProfileEditRequest,
    requestRosterProfileEdit,
    rosterProfileEditRequest,
  } = useRosterProfileEditRequest();
  const {
    canDisableContextMenuRosterUser,
    canEditContextMenuRosterUser,
    canUpdateRosterUser,
    canUpdateSelectedRosterEntry,
  } = useRosterActionPermissions({
    authUserId,
    canDisableRosterUsers,
    contextMenu,
    directory,
    selectedRosterUser,
  });

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
      requestRosterProfileEdit(userId);
    },
    [canUpdateRosterUser, openRosterUser, requestRosterProfileEdit],
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
    canDisableContextMenuRosterUser,
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
