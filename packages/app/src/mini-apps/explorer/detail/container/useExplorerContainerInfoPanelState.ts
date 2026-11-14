import type {
  ContainerInfo,
  ContainerNode,
  ContainerShareAccessLevel,
  OrganizationDirectoryAndGroups,
} from "@tearleads/client-sdk";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import type { MiniAppSelectMenuOption } from "../../../../components/mini-app/controls/MiniAppSelectMenuState";
import { EXPLORER_LABELS } from "../../labels";
import type { MiniAppWindowPosition } from "../../types";
import type { ExplorerAttributionUserLabelResolver } from "../attributionDisplay";
import { compactId } from "../compactId";
import {
  type ExplorerContainerInfoUserShareRequest,
  useExplorerContainerInfo,
  useExplorerContainerInfoGroupShare,
  useExplorerContainerInfoUserShare,
} from "./ExplorerContainerInfoState";
import {
  DEFAULT_SHARE_ACCESS_LEVEL,
  type ExplorerContainerInfoGrant,
  type ExplorerShareScope,
  getContainerInfoShareableGroups,
  getContainerInfoShareableUsers,
} from "./explorerContainerInfoStateHelpers";

export interface ExplorerContainerInfoPanelProps {
  canManageIcon: boolean;
  containerIcon: string | null;
  containerId: string;
  containerName: string | undefined;
  containerSyncStatus: string | null;
  containerNamesById: ReadonlyMap<string, string>;
  canShareContainer: boolean;
  canShareWithPeer: boolean;
  primaryDocumentSettings: ReactNode;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  logError: (message: string | Error, cause?: unknown) => void;
  onOpenGrant: (
    grant: {
      containerId: string;
      subjectId: string;
      subjectType: "group" | "user";
    },
    position?: MiniAppWindowPosition,
  ) => void;
  readModelProjection?: OrganizationDirectoryAndGroups | null | undefined;
  readModelRevision?: number | undefined;
  readModelScope?: object | null | undefined;
  peerUserId: string | null;
  // Roster profile names for user principals; unresolved users show their ID.
  resolveUserLabel?: ExplorerAttributionUserLabelResolver | undefined;
  setContainerIcon: (
    containerId: string,
    icon: string | null,
  ) => Promise<ContainerNode | null>;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ContainerShareAccessLevel,
    options: { expectedGroupName: string },
  ) => Promise<boolean>;
  shareWithUser: (
    containerId: string,
    userId: string,
    accessLevel: ContainerShareAccessLevel,
  ) => Promise<boolean>;
  // The session the panel shares in; a share pending across a switch stops.
  shareScope: ExplorerShareScope;
}

export type ContainerInfoTabId = "general" | "sharing" | "security" | "sync";

export type ExplorerShareSubjectType =
  ExplorerContainerInfoGrant["subjectType"];

/** The New Share form's choices, handed down as one unit. */
export interface ExplorerContainerInfoShareDraft {
  accessLevel: ContainerShareAccessLevel;
  groupId: string;
  groupOptions: ReadonlyArray<MiniAppSelectMenuOption>;
  setAccessLevel: (value: ContainerShareAccessLevel) => void;
  setGroupId: (value: string) => void;
  setSubjectType: (value: ExplorerShareSubjectType) => void;
  setUserId: (value: string) => void;
  subjectType: ExplorerShareSubjectType;
  userId: string;
  userOptions: ReadonlyArray<MiniAppSelectMenuOption>;
}

function getShareableUserOptions(
  remoteInfo: ContainerInfo["remoteInfo"] | undefined,
  readModelProjection: OrganizationDirectoryAndGroups | null | undefined,
  resolveUserLabel: ExplorerAttributionUserLabelResolver | undefined,
): MiniAppSelectMenuOption[] {
  if (!remoteInfo || !readModelProjection) {
    return [];
  }
  return getContainerInfoShareableUsers(
    remoteInfo,
    readModelProjection.directory.users,
  ).map((user) => {
    const userIdLabel = compactId(user.userId);
    const displayName = resolveUserLabel?.(user.userId);
    // A profile name may repeat, so the ID stays visible in the menu.
    return displayName
      ? { id: user.userId, label: displayName, secondaryLabel: userIdLabel }
      : { id: user.userId, label: userIdLabel };
  });
}

// The recipient kind and user pick. No user is preselected, and a pick who
// leaves the roster or gains a grant clears instead of falling to another
// member, so a user share always names the person who was chosen.
function useExplorerContainerInfoUserDraft(params: {
  containerId: string;
  readModelProjection: OrganizationDirectoryAndGroups | null | undefined;
  remoteInfo: ContainerInfo["remoteInfo"] | undefined;
  resolveUserLabel: ExplorerAttributionUserLabelResolver | undefined;
}) {
  const [subjectType, setSubjectType] =
    useState<ExplorerShareSubjectType>("group");
  const [draftUserId, setDraftUserId] = useState("");
  const userOptions = getShareableUserOptions(
    params.remoteInfo,
    params.readModelProjection,
    params.resolveUserLabel,
  );
  const userId = userOptions.some((option) => option.id === draftUserId)
    ? draftUserId
    : "";

  useEffect(() => {
    setSubjectType("group");
    setDraftUserId("");
  }, [params.containerId]);

  return {
    setSubjectType,
    setUserId: setDraftUserId,
    subjectType,
    userId,
    userOptions,
  };
}

// The form submits whichever recipient kind is chosen; the demo peer button
// shares outside the form with the default permission.
function useExplorerContainerInfoShareSubmit(params: {
  accessLevel: ContainerShareAccessLevel;
  handleShareWithGroup: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  peerUserId: string | null;
  setPanelError: (error: string | null) => void;
  shareWithUser: (
    request: ExplorerContainerInfoUserShareRequest,
  ) => Promise<void>;
  subjectType: ExplorerShareSubjectType;
  userId: string;
}) {
  const {
    accessLevel,
    handleShareWithGroup,
    peerUserId,
    setPanelError,
    shareWithUser,
    subjectType,
    userId,
  } = params;
  const handleShare = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      if (subjectType === "group") {
        await handleShareWithGroup(event);
        return;
      }
      event.preventDefault();
      if (!userId) {
        setPanelError(EXPLORER_LABELS.containerInfoChooseUserError);
        return;
      }
      await shareWithUser({
        accessLevel,
        failureLabel: EXPLORER_LABELS.containerInfoShareToUserFailure,
        userId,
      });
    },
    [
      accessLevel,
      handleShareWithGroup,
      setPanelError,
      shareWithUser,
      subjectType,
      userId,
    ],
  );
  const handleShareWithPeer = useCallback(() => {
    if (!peerUserId) {
      return;
    }
    void shareWithUser({
      accessLevel: DEFAULT_SHARE_ACCESS_LEVEL,
      failureLabel: EXPLORER_LABELS.containerInfoShareToPeerFailure,
      userId: peerUserId,
    });
  }, [peerUserId, shareWithUser]);
  return { handleShare, handleShareWithPeer };
}

export function useExplorerContainerInfoPanelState(
  params: ExplorerContainerInfoPanelProps,
) {
  const { containerId } = params;
  const [activeTab, setActiveTab] = useState<ContainerInfoTabId>("general");
  const containerInfoState = useExplorerContainerInfo({
    containerId,
    loadContainerInfo: params.loadContainerInfo,
    organizationReadModelProjection: params.readModelProjection,
    organizationReadModelRevision: params.readModelRevision,
    organizationReadModelScope: params.readModelScope,
    reloadToken: params.containerSyncStatus,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const remoteInfo = containerInfoState.containerInfo?.remoteInfo;
  const { setPanelError } = containerInfoState;
  const groupOptions = remoteInfo
    ? getContainerInfoShareableGroups(remoteInfo).map((group) => ({
        id: group.groupId,
        label: group.name,
      }))
    : [];
  const userDraft = useExplorerContainerInfoUserDraft({
    containerId,
    readModelProjection: params.readModelProjection,
    remoteInfo,
    resolveUserLabel: params.resolveUserLabel,
  });
  const shareParams = {
    canShareContainer: params.canShareContainer,
    containerId,
    isSubmitting,
    logError: params.logError,
    reloadContainerInfo: containerInfoState.reloadContainerInfo,
    setIsSubmitting,
    setPanelError,
    shareScope: params.shareScope,
  };
  const handleShareWithGroup = useExplorerContainerInfoGroupShare({
    ...shareParams,
    draftShareAccessLevel: containerInfoState.draftShareAccessLevel,
    draftShareGroupId: containerInfoState.draftShareGroupId,
    // The label bound to the signed group name is the one displayed for the
    // chosen id at the moment Share is clicked, so what the user sees and
    // what the SDK verifies never diverge; the default selection carries its
    // label the same way. A label the read model changed underneath fails the
    // share closed at the SDK rather than binding a stale one.
    draftShareGroupName: groupOptions.find(
      (group) => group.id === containerInfoState.draftShareGroupId,
    )?.label,
    shareWithGroup: params.shareWithGroup,
  });
  const shareWithUser = useExplorerContainerInfoUserShare({
    ...shareParams,
    shareWithUser: params.shareWithUser,
  });
  const { draftShareAccessLevel } = containerInfoState;
  const { handleShare, handleShareWithPeer } =
    useExplorerContainerInfoShareSubmit({
      accessLevel: draftShareAccessLevel,
      handleShareWithGroup,
      peerUserId: params.peerUserId,
      setPanelError,
      shareWithUser,
      subjectType: userDraft.subjectType,
      userId: userDraft.userId,
    });

  useEffect(() => {
    setActiveTab("general");
  }, [containerId]);

  const shareDraft: ExplorerContainerInfoShareDraft = {
    accessLevel: draftShareAccessLevel,
    groupId: containerInfoState.draftShareGroupId,
    groupOptions,
    setAccessLevel: containerInfoState.setDraftShareAccessLevel,
    setGroupId: containerInfoState.setDraftShareGroupId,
    ...userDraft,
  };

  return {
    activeTab,
    containerInfo: containerInfoState.containerInfo,
    containerInfoError: containerInfoState.containerInfoError,
    handleShare,
    handleShareWithPeer,
    isLoadingContainerInfo: containerInfoState.isLoadingContainerInfo,
    isSubmitting,
    panelError: containerInfoState.panelError,
    setActiveTab,
    setPanelError,
    shareDraft,
  };
}
