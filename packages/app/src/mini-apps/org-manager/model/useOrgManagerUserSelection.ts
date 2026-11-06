import type { OrganizationUserDetail } from "@tearleads/client-sdk";
import { useCallback, useRef, useState } from "react";
import type { OrgManagerView } from "../routes";

/** The selected roster user, its loaded detail, and section navigation. */
export function useOrgManagerUserSelection(params: {
  selectGroup: (groupId: string | null) => void;
  setView: (view: OrgManagerView) => void;
}) {
  const { selectGroup, setView } = params;
  const [selectedUserId, setSelectedUserIdState] = useState<string | null>(
    null,
  );
  const [userDetail, setUserDetail] = useState<OrganizationUserDetail | null>(
    null,
  );
  const selectedUserIdRef = useRef<string | null>(null);
  const selectUser = useCallback((userId: string | null) => {
    selectedUserIdRef.current = userId;
    setSelectedUserIdState(userId);
    setUserDetail(null);
  }, []);
  const setOrgManagerView = useCallback(
    (nextView: OrgManagerView) => {
      if (nextView === "directory") {
        selectUser(null);
      }
      if (nextView === "groups") {
        selectGroup(null);
      }
      setView(nextView);
    },
    [selectGroup, selectUser, setView],
  );
  return {
    selectUser,
    selectedUserId,
    selectedUserIdRef,
    setOrgManagerView,
    setUserDetail,
    userDetail,
  };
}
