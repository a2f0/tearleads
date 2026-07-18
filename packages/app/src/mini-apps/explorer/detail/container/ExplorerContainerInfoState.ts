import type {
  ContainerInfo,
  ContainerShareAccessLevel,
  OrganizationDirectoryAndGroups,
} from "@tearleads/client-sdk";
import { type FormEvent, useCallback, useRef, useState } from "react";
import { EXPLORER_LABELS } from "../../labels";
import {
  DEFAULT_SHARE_ACCESS_LEVEL,
  type ReloadExplorerContainerInfo,
  type ReloadExplorerContainerInfoOptions,
  reloadExplorerContainerInfo,
  useContainerInfoAutoReload,
  useContainerInfoOrganizationGroups,
  useMountedRef,
} from "./explorerContainerInfoStateHelpers";

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

interface ExplorerContainerInfoParams {
  containerId: string;
  loadContainerInfo: (containerId: string) => Promise<ContainerInfo>;
  organizationReadModelProjection?:
    | OrganizationDirectoryAndGroups
    | null
    | undefined;
  organizationReadModelRevision?: number | undefined;
  organizationReadModelScope?: object | null | undefined;
  reloadToken?: string | null | undefined;
}

function useScopedContainerInfoState(
  presentationScope: object | null | undefined,
) {
  const [containerInfo, setContainerInfoState] = useState<ContainerInfo | null>(
    null,
  );
  const [committedPresentationScope, setCommittedPresentationScope] =
    useState(presentationScope);
  const setContainerInfo = useCallback(
    (info: ContainerInfo | null) => {
      setContainerInfoState(info);
      setCommittedPresentationScope(presentationScope);
    },
    [presentationScope],
  );
  const hasCurrentPresentationScope =
    presentationScope === undefined ||
    (presentationScope !== null &&
      committedPresentationScope === presentationScope);
  return { containerInfo, hasCurrentPresentationScope, setContainerInfo };
}

export function useExplorerContainerInfo(params: ExplorerContainerInfoParams) {
  const {
    containerId,
    loadContainerInfo,
    organizationReadModelProjection,
    organizationReadModelRevision = 0,
    organizationReadModelScope,
    reloadToken,
  } = params;
  const {
    containerInfo,
    hasCurrentPresentationScope,
    setContainerInfo: setScopedContainerInfo,
  } = useScopedContainerInfoState(organizationReadModelScope);
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
  const loadContainerInfoRef = useRef(loadContainerInfo);
  loadContainerInfoRef.current = loadContainerInfo;
  const organizationGroupsRef = useContainerInfoOrganizationGroups({
    containerId,
    containerInfoRef,
    projection: organizationReadModelProjection,
    revision: organizationReadModelRevision,
    setContainerInfo: setScopedContainerInfo,
    setDraftShareGroupId,
  });
  const requestIdRef = useRef(0);

  const reloadContainerInfo = useCallback(
    (options: ReloadExplorerContainerInfoOptions = {}) =>
      reloadExplorerContainerInfo(
        {
          containerId,
          containerInfoRef,
          isMountedRef,
          loadContainerInfo: (requestedContainerId) =>
            loadContainerInfoRef.current(requestedContainerId),
          organizationGroupsRef,
          requestIdRef,
          setContainerInfo: setScopedContainerInfo,
          setContainerInfoError,
          setDraftShareAccessLevel,
          setDraftShareGroupId,
          setIsLoadingContainerInfo,
          setPanelError,
        },
        options,
      ),
    [containerId, setScopedContainerInfo],
  );

  useContainerInfoAutoReload({
    containerId,
    presentationScope: organizationReadModelScope,
    reloadContainerInfo,
    reloadToken,
  });

  return {
    containerInfo: hasCurrentPresentationScope ? containerInfo : null,
    containerInfoError: hasCurrentPresentationScope ? containerInfoError : null,
    draftShareAccessLevel: hasCurrentPresentationScope
      ? draftShareAccessLevel
      : DEFAULT_SHARE_ACCESS_LEVEL,
    draftShareGroupId: hasCurrentPresentationScope ? draftShareGroupId : "",
    isLoadingContainerInfo: hasCurrentPresentationScope
      ? isLoadingContainerInfo
      : false,
    panelError: hasCurrentPresentationScope ? panelError : null,
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
