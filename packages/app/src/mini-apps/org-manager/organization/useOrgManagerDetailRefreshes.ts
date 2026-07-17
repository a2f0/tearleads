import { useEffect } from "react";
import type { OrgManagerView } from "../routes";

interface OrgManagerDetailRefreshesInput {
  readonly refreshSelectedGroupDetails: (
    groupId: string | null,
  ) => Promise<void>;
  readonly refreshSelectedUserDetail: (userId: string | null) => Promise<void>;
  readonly selectedGroupId: string | null;
  readonly selectedUserId: string | null;
  readonly skippedGroupDetailsEffectRef: {
    current: { groupId: string | null } | null;
  };
  readonly view: OrgManagerView;
}

/** Loads selection details only while their owning view is visible. */
export function useOrgManagerDetailRefreshes(
  input: OrgManagerDetailRefreshesInput,
): void {
  useEffect(() => {
    if (input.view !== "groups") {
      return;
    }

    const skippedGroupDetailsEffect =
      input.skippedGroupDetailsEffectRef.current;
    input.skippedGroupDetailsEffectRef.current = null;
    if (skippedGroupDetailsEffect?.groupId === input.selectedGroupId) {
      return;
    }

    void input.refreshSelectedGroupDetails(input.selectedGroupId);
  }, [
    input.refreshSelectedGroupDetails,
    input.selectedGroupId,
    input.skippedGroupDetailsEffectRef,
    input.view,
  ]);

  useEffect(() => {
    if (input.view === "directory") {
      void input.refreshSelectedUserDetail(input.selectedUserId);
    }
  }, [input.refreshSelectedUserDetail, input.selectedUserId, input.view]);
}
