import { useEffect } from "react";
import type { GroupDetailsEffectKey } from "../refresh";
import type { OrgManagerView } from "../routes";

interface OrgManagerDetailRefreshEffectsInput {
  readonly readModelCursor: string | null;
  readonly refreshSelectedGroupContainers: (
    groupId: string | null,
  ) => Promise<void>;
  readonly refreshSelectedGroupDetails: (
    groupId: string | null,
  ) => Promise<void>;
  readonly refreshSelectedUserDetail: (userId: string | null) => Promise<void>;
  readonly selectedGroupAvailable: boolean;
  readonly selectedGroupId: string | null;
  readonly selectedGroupStateHash: string | null;
  readonly selectedUserId: string | null;
  readonly skippedGroupDetailsEffectRef: {
    current: GroupDetailsEffectKey | null;
  };
  readonly view: OrgManagerView;
}

/** Loads selection details only while their owning view is visible. */
export function useOrgManagerDetailRefreshEffects(
  input: OrgManagerDetailRefreshEffectsInput,
): void {
  useEffect(() => {
    if (
      input.view !== "groups" ||
      (input.selectedGroupId !== null && !input.selectedGroupAvailable)
    ) {
      return;
    }

    const skippedGroupDetailsEffect =
      input.skippedGroupDetailsEffectRef.current;
    input.skippedGroupDetailsEffectRef.current = null;
    if (
      skippedGroupDetailsEffect?.groupId === input.selectedGroupId &&
      skippedGroupDetailsEffect.stateHash === input.selectedGroupStateHash
    ) {
      return;
    }

    void input.refreshSelectedGroupDetails(input.selectedGroupId);
  }, [
    input.refreshSelectedGroupDetails,
    input.selectedGroupAvailable,
    input.selectedGroupId,
    input.selectedGroupStateHash,
    input.skippedGroupDetailsEffectRef,
    input.view,
  ]);

  useEffect(() => {
    if (
      input.view === "groups" &&
      (input.selectedGroupId === null || input.selectedGroupAvailable)
    ) {
      void input.refreshSelectedGroupContainers(input.selectedGroupId);
    }
  }, [
    input.readModelCursor,
    input.refreshSelectedGroupContainers,
    input.selectedGroupAvailable,
    input.selectedGroupId,
    input.view,
  ]);

  useEffect(() => {
    if (input.view === "directory") {
      void input.refreshSelectedUserDetail(input.selectedUserId);
    }
  }, [
    input.readModelCursor,
    input.refreshSelectedUserDetail,
    input.selectedUserId,
    input.view,
  ]);
}
