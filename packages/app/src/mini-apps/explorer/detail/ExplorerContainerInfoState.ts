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
import { EXPLORER_LABELS } from "../labels";

const DEFAULT_SHARE_ACCESS_LEVEL: ContainerShareAccessLevel = "write";

export type ExplorerContainerInfoGrant = NonNullable<
  ContainerInfo["remoteInfo"]
>["grants"][number];

export type ReloadExplorerContainerInfo = (options?: {
  optimisticGrant?: ExplorerContainerInfoGrant | null;
  resetDrafts?: boolean;
}) => Promise<void>;

interface ExplorerContainerInfoShareParams {
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

  const existingGrants = info.remoteInfo.grants ?? [];
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
  const existingGrantRows = info.remoteInfo.grantRows ?? [];
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

function getInitialDraftShareGroupId(info: ContainerInfo): string {
  return (
    info.remoteInfo?.groups.find((group) => group.currentState)?.groupId ?? ""
  );
}

function getNextDraftShareGroupId(
  info: ContainerInfo,
  currentGroupId: string,
): string {
  const groups = info.remoteInfo?.groups ?? [];
  const currentGroupIsShareable = groups.some(
    (group) => group.groupId === currentGroupId && group.currentState,
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

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCurrentContainerInfoRequest(params: {
  isMounted: boolean;
  requestId: number;
  activeRequestId: number;
}): boolean {
  return params.isMounted && params.activeRequestId === params.requestId;
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

export function useExplorerContainerInfo(params: {
  containerId: string;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
}) {
  const { containerId, loadContainerInfo } = params;
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
  const requestIdRef = useRef(0);

  const reloadContainerInfo = useCallback(
    async (
      options: {
        optimisticGrant?: ExplorerContainerInfoGrant | null;
        resetDrafts?: boolean;
      } = {},
    ) => {
      const requestId = requestIdRef.current + 1;
      const isCurrentRequest = () =>
        isCurrentContainerInfoRequest({
          activeRequestId: requestIdRef.current,
          isMounted: isMountedRef.current,
          requestId,
        });
      requestIdRef.current = requestId;
      setIsLoadingContainerInfo(true);
      setContainerInfoError(null);
      if (options.resetDrafts) {
        setContainerInfo(null);
        setDraftShareGroupId("");
        setDraftShareAccessLevel(DEFAULT_SHARE_ACCESS_LEVEL);
        setPanelError(null);
      }

      try {
        const nextInfo = await loadContainerInfo(containerId);
        if (!isCurrentRequest()) {
          return;
        }

        const updatedInfo = upsertContainerInfoGrant(
          nextInfo,
          options.optimisticGrant ?? null,
          containerId,
        );
        setContainerInfo(updatedInfo);
        setDraftShareGroupId((current) =>
          getReloadedDraftShareGroupId({
            currentGroupId: current,
            info: updatedInfo,
            resetDrafts: options.resetDrafts ?? false,
          }),
        );
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }

        setContainerInfo(null);
        setContainerInfoError(unknownErrorMessage(error));
      } finally {
        if (isCurrentRequest()) {
          setIsLoadingContainerInfo(false);
        }
      }
    },
    [containerId, loadContainerInfo],
  );

  useEffect(() => {
    void reloadContainerInfo({ resetDrafts: true });
  }, [reloadContainerInfo]);

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
      if (isSubmitting) {
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
    containerId,
    isSubmitting,
    peerUserId,
    reloadContainerInfo,
    setIsSubmitting,
    setPanelError,
    shareWithUser,
  } = params;

  return useCallback(async () => {
    if (isSubmitting || !peerUserId) {
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
    containerId,
    isSubmitting,
    peerUserId,
    reloadContainerInfo,
    setIsSubmitting,
    setPanelError,
    shareWithUser,
  ]);
}
