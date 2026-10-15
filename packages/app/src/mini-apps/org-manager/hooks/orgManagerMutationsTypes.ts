import type {
  OrganizationContainerGrants,
  OrganizationDirectory,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRefreshers } from "../refreshers/useOrgManagerRefreshers";
import type { OrgManagerView } from "../routes";

type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

export interface OrgManagerMutationsParams {
  addUserId: string;
  appData: ReturnType<typeof useTearleadsRuntime>;
  canDeleteGroup: (group: OrganizationGroupSummary) => boolean;
  canDisableRosterUsers: boolean;
  canImportRosterUser: boolean;
  directory: OrganizationDirectory | null;
  groupNameDraft: string;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  importUserIdDraft: string;
  invalidateSelectedGroupDetails: Refreshers["invalidateSelectedGroupDetails"];
  memberGroupId: string | null;
  members: OrganizationGroupMembers | null;
  openGroupRoute: (groupId: string) => void;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  refreshDirectoryAndGroups: Refreshers["refreshDirectoryAndGroups"];
  refreshSelectedGroupDetails: Refreshers["refreshSelectedGroupDetails"];
  refreshSelectedUserDetail: Refreshers["refreshSelectedUserDetail"];
  selectGroup: (groupId: string | null) => void;
  selectUser: (userId: string | null) => void;
  selectedGroupId: string | null;
  selectedGroupIdRef: { current: string | null };
  selectedGroupIsAdminsGroup: boolean;
  selectedGroupIsMembersGroup: boolean;
  selectedUserIdRef: { current: string | null };
  setAddUserId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setGrants: Dispatch<SetStateAction<OrganizationContainerGrants | null>>;
  setGroupContainers: Dispatch<
    SetStateAction<OrganizationGroupContainers | null>
  >;
  setGroupPolicyHistory: Dispatch<
    SetStateAction<OrganizationGroupPolicyHistory | null>
  >;
  setGroupNameDraft: Dispatch<SetStateAction<string>>;
  setImportUserIdDraft: Dispatch<SetStateAction<string>>;
  setIsCreateGroupDialogOpen: Dispatch<SetStateAction<boolean>>;
  setIsImportUserDialogOpen: Dispatch<SetStateAction<boolean>>;
  setMembers: Dispatch<SetStateAction<OrganizationGroupMembers | null>>;
  setMutating: Dispatch<SetStateAction<boolean>>;
  setOrgManagerView: (nextView: OrgManagerView) => void;
  setUserDetail: Dispatch<SetStateAction<OrganizationUserDetail | null>>;
}
