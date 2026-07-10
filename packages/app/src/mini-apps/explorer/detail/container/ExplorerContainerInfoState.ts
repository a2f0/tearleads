import type {
  ContainerInfo,
  ContainerShareAccessLevel,
} from "@tearleads/client-sdk";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";
import { EXPLORER_LABELS } from "../../labels";

const DEFAULT_SHARE_ACCESS_LEVEL: ContainerShareAccessLevel = "write";

export type ExplorerContainerInfoGrant = NonNullable<
  ContainerInfo["remoteInfo"]
>["grants"][number];
type ExplorerContainerInfoGroup = NonNullable<
  ContainerInfo["remoteInfo"]
>["groups"][number];

export type ReloadExplorerContainerInfo = (options?: {
  optimisticGrant?: ExplorerContainerInfoGrant | null;
  preserveDrafts?: boolean;
  resetDrafts?: boolean;
}) => Promise<void>;

interface ReloadExplorerContainerInfoOptions {
  optimisticGrant?: ExplorerContainerInfoGrant | null;
  preserveDrafts?: boolean;
  resetDrafts?: boolean;
}

interface ExplorerContainerInfoShareParams {
  canShareContainer: boolean;
  containerId: string;
  isSubmitting: boolean;
  reloadContainerInfo: ReloadExplorerContainerInfo;
  setIsSubmitting: (value: boolean) => void;
  setPanelError: (error: string | null) => void;
}

interface ExplorerContainerInfoGroupShareParams
  extends ExplorerContainerInfoShareParams {
  draftShareAccessLevel: ContainerShareAccessLevel;
  draftShareGroupId: string;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ContainerShareAccessLevel,
  ) => Promise<boolean>;
}

interface ExplorerContainerInfoPeerShareParams
  extends ExplorerContainerInfoShareParams {
  peerUserId: string | null;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}

export function upsertContainerInfoGrant(
  info: ContainerInfo,
  grant: ExplorerContainerInfoGrant | null,
  containerId: string,
): ContainerInfo {
  if (!grant || !info.remoteInfo) {
    return info;
  }

  const existingGrants = info.remoteInfo.grants;
  const existingGrantIndex = existingGrants.findIndex(
    (candidate) =>
      candidate.subjectType === grant.subjectType &&
      candidate.subjectId === grant.subjectId,
  );
  const grants =
    existingGrantIndex === -1
      ? [...existingGrants, grant]
      : existingGrants.map((candidate, index) =>
          index === existingGrantIndex ? { ...candidate, ...grant } : candidate,
        );
  const directGrantRow = {
    ...grant,
    inherited: false,
    sourceContainerId: containerId,
  };
  const existingGrantRows = info.remoteInfo.grantRows;
  const existingGrantRowIndex = existingGrantRows.findIndex(
    (candidate) =>
      !candidate.inherited &&
      candidate.sourceContainerId === containerId &&
      candidate.subjectType === grant.subjectType &&
      candidate.subjectId === grant.subjectId,
  );
  const grantRows =
    existingGrantRowIndex === -1
      ? [...existingGrantRows, directGrantRow]
      : existingGrantRows.map((candidate, index) =>
          index === existingGrantRowIndex
            ? { ...candidate, ...directGrantRow }
            : candidate,
        );

  return {
    ...info,
    remoteInfo: {
      ...info.remoteInfo,
      grantRows,
      grants,
    },
  };
}

export function getContainerInfoShareableGroups(
  remoteInfo: NonNullable<ContainerInfo["remoteInfo"]>,
): ExplorerContainerInfoGroup[] {
  const directlyGrantedGroupIds = new Set(
    remoteInfo.grants.flatMap((grant) =>
      grant.subjectType === "group" ? [grant.subjectId] : [],
    ),
  );

  return remoteInfo.groups.filter(
    (group) =>
      group.currentState && !directlyGrantedGroupIds.has(group.groupId),
  );
}

function getInitialDraftShareGroupId(info: ContainerInfo): string {
  return info.remoteInfo
    ? (getContainerInfoShareableGroups(info.remoteInfo)[0]?.groupId ?? "")
    : "";
}

function getNextDraftShareGroupId(
  info: ContainerInfo,
  currentGroupId: string,
): string {
  const shareableGroups = info.remoteInfo
    ? getContainerInfoShareableGroups(info.remoteInfo)
    : [];
  const currentGroupIsShareable = shareableGroups.some(
    (group) => group.groupId === currentGroupId,
  );
  if (currentGroupIsShareable) {
    return currentGroupId;
  }

  return getInitialDraftShareGroupId(info);
}

function getReloadedDraftShareGroupId(params: {
  currentGroupId: string;
  info: ContainerInfo;
  resetDrafts: boolean;
}): string {
  if (params.resetDrafts) {
    return getInitialDraftShareGroupId(params.info);
  }

  return getNextDraftShareGroupId(params.info, params.currentGroupId);
}

function isCurrentContainerInfoRequest(
  isMountedRef: { current: boolean },
  requestIdRef: { current: number },
  requestId: number,
): boolean {
  return isMountedRef.current && requestIdRef.current === requestId;
}

function useMountedRef() {
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return isMountedRef;
}

function commitContainerInfo(params: {
  containerId: string;
  containerInfoRef: { current: ContainerInfo | null };
  info: ContainerInfo;
  options?: ReloadExplorerContainerInfoOptions;
  setContainerInfo: (info: ContainerInfo) => void;
  setDraftShareGroupId: (updater: (current: string) => string) => void;
}) {
  const {
    containerId,
    containerInfoRef,
    info,
    options = {},
    setContainerInfo,
    setDraftShareGroupId,
  } = params;
  const updatedInfo = upsertContainerInfoGrant(
    info,
    options.optimisticGrant ?? null,
    containerId,
  );
  containerInfoRef.current = updatedInfo;
  setContainerInfo(updatedInfo);
  if (options.preserveDrafts) {
    return;
  }

  setDraftShareGroupId((current) =>
    getReloadedDraftShareGroupId({
      currentGroupId: current,
      info: updatedInfo,
      resetDrafts: options.resetDrafts ?? false,
    }),
  );
}

function resetContainerInfoState(params: {
  containerInfoRef: { current: ContainerInfo | null };
  setContainerInfo: (info: ContainerInfo | null) => void;
  setDraftShareAccessLevel: (value: ContainerShareAccessLevel) => void;
  setDraftShareGroupId: (value: string) => void;
  setPanelError: (error: string | null) => void;
}) {
  params.containerInfoRef.current = null;
  params.setContainerInfo(null);
  params.setDraftShareGroupId("");
  params.setDraftShareAccessLevel(DEFAULT_SHARE_ACCESS_LEVEL);
  params.setPanelError(null);
}

function useContainerInfoAutoReload(params: {
  containerId: string;
  reloadContainerInfo: ReloadExplorerContainerInfo;
  reloadToken?: string | null | undefined;
}) {
  const { containerId, reloadContainerInfo, reloadToken } = params;
  const previousContainerIdRef = useRef<string | null>(null);
  useEffect(() => {
    const resetDrafts = previousContainerIdRef.current !== containerId;
    previousContainerIdRef.current = containerId;
    void reloadContainerInfo({
      preserveDrafts: !resetDrafts,
      resetDrafts,
    });
  }, [containerId, reloadContainerInfo, reloadToken]);
}

export function useExplorerContainerInfo(params: {
  containerId: string;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  reloadToken?: string | null | undefined;
}) {
  const { containerId, loadContainerInfo, reloadToken } = params;
  const [containerInfo, setContainerInfo] = useState<ContainerInfo | null>(
    null,
  );
  const [containerInfoError, setContainerInfoError] = useState<string | null>(
    null,
  );
  const [draftShareAccessLevel, setDraftShareAccessLevel] = useState(
    DEFAULT_SHARE_ACCESS_LEVEL,
  );
  const [draftShareGroupId, setDraftShareGroupId] = useState("");
  const [isLoadingContainerInfo, setIsLoadingContainerInfo] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const isMountedRef = useMountedRef();
  const containerInfoRef = useRef<ContainerInfo | null>(null);
  const requestIdRef = useRef(0);

  const reloadContainerInfo = useCallback(
    async (options: ReloadExplorerContainerInfoOptions = {}) => {
      const requestId = requestIdRef.current + 1;
      const isCurrentRequest = () =>
        isCurrentContainerInfoRequest(isMountedRef, requestIdRef, requestId);
      const commitInfo = (
        info: ContainerInfo,
        commitOptions: ReloadExplorerContainerInfoOptions = {},
      ) =>
        commitContainerInfo({
          containerId,
          containerInfoRef,
          info,
          options: commitOptions,
          setContainerInfo,
          setDraftShareGroupId,
        });
      requestIdRef.current = requestId;
      setIsLoadingContainerInfo(true);
      setContainerInfoError(null);
      if (options.resetDrafts) {
        resetContainerInfoState({
          containerInfoRef,
          setContainerInfo,
          setDraftShareAccessLevel,
          setDraftShareGroupId,
          setPanelError,
        });
      }

      const optimisticInfo = containerInfoRef.current;
      if (options.optimisticGrant && !options.resetDrafts && optimisticInfo) {
        commitInfo(optimisticInfo, {
          optimisticGrant: options.optimisticGrant,
        });
      }

      try {
        const nextInfo = await loadContainerInfo(containerId);
        if (!isCurrentRequest()) {
          return;
        }

        commitInfo(nextInfo, options);
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }

        if (!options.optimisticGrant || !containerInfoRef.current) {
          containerInfoRef.current = null;
          setContainerInfo(null);
        }
        setContainerInfoError(unknownErrorMessage(error));
      } finally {
        if (isCurrentRequest()) {
          setIsLoadingContainerInfo(false);
        }
      }
    },
    [containerId, loadContainerInfo],
  );

  useContainerInfoAutoReload({ containerId, reloadContainerInfo, reloadToken });

  return {
    containerInfo,
    containerInfoError,
    draftShareAccessLevel,
    draftShareGroupId,
    isLoadingContainerInfo,
    panelError,
    reloadContainerInfo,
    setDraftShareAccessLevel,
    setDraftShareGroupId,
    setPanelError,
  };
}

export function useExplorerContainerInfoGroupShare(
  params: ExplorerContainerInfoGroupShareParams,
) {
  const {
    canShareContainer,
    containerId,
    draftShareAccessLevel,
    draftShareGroupId,
    isSubmitting,
    reloadContainerInfo,
    setIsSubmitting,
    setPanelError,
    shareWithGroup,
  } = params;

  return useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isSubmitting || !canShareContainer) {
        return;
      }

      if (!draftShareGroupId) {
        setPanelError(EXPLORER_LABELS.containerInfoChooseGroupError);
        return;
      }

      setIsSubmitting(true);
      setPanelError(null);
      try {
        const shared = await shareWithGroup(
          containerId,
          draftShareGroupId,
          draftShareAccessLevel,
        );
        if (!shared) {
          setPanelError(EXPLORER_LABELS.containerInfoShareToGroupFailure);
          return;
        }

        await reloadContainerInfo({
          optimisticGrant: {
            accessLevel: draftShareAccessLevel,
            subjectId: draftShareGroupId,
            subjectType: "group",
          },
        });
      } catch (error) {
        console.error(
          EXPLORER_LABELS.containerInfoShareGenericFailureLog,
          error,
        );
        setPanelError(EXPLORER_LABELS.containerInfoShareGenericFailure);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      canShareContainer,
      containerId,
      draftShareAccessLevel,
      draftShareGroupId,
      isSubmitting,
      reloadContainerInfo,
      setIsSubmitting,
      setPanelError,
      shareWithGroup,
    ],
  );
}

export function useExplorerContainerInfoPeerShare(
  params: ExplorerContainerInfoPeerShareParams,
) {
  const {
    canShareContainer,
    containerId,
    isSubmitting,
    peerUserId,
    reloadContainerInfo,
    setIsSubmitting,
    setPanelError,
    shareWithUser,
  } = params;

  return useCallback(async () => {
    if (isSubmitting || !peerUserId || !canShareContainer) {
      return;
    }

    setIsSubmitting(true);
    setPanelError(null);
    try {
      const shared = await shareWithUser(containerId, peerUserId);
      if (!shared) {
        setPanelError(EXPLORER_LABELS.containerInfoShareToPeerFailure);
        return;
      }

      await reloadContainerInfo({
        optimisticGrant: {
          accessLevel: DEFAULT_SHARE_ACCESS_LEVEL,
          subjectId: peerUserId,
          subjectType: "user",
        },
      });
    } catch (error) {
      console.error(EXPLORER_LABELS.containerInfoShareToPeerFailureLog, error);
      setPanelError(EXPLORER_LABELS.containerInfoShareToPeerFailure);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    canShareContainer,
    containerId,
    isSubmitting,
    peerUserId,
    reloadContainerInfo,
    setIsSubmitting,
    setPanelError,
    shareWithUser,
  ]);
}
