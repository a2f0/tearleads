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
  /**
   * The label the user picked the group by. Passed to the share so the SDK
   * can check it against the name committed in the signed group policy.
   */
  draftShareGroupName?: string | undefined;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ContainerShareAccessLevel,
    options: { expectedGroupName: string },
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

// The shared submit body of the group and peer share flows: run the share,
// surface its failure label, and optimistically fold the new grant into the
// panel's container info on success.
async function runContainerInfoShare(params: {
  errorLabel: string;
  errorLogLabel: string;
  failureLabel: string;
  optimisticGrant: NonNullable<
    ReloadExplorerContainerInfoOptions["optimisticGrant"]
  >;
  reloadContainerInfo: ReloadExplorerContainerInfo;
  setIsSubmitting: (value: boolean) => void;
  setPanelError: (error: string | null) => void;
  share: () => Promise<boolean>;
}): Promise<void> {
  const {
    errorLabel,
    errorLogLabel,
    failureLabel,
    optimisticGrant,
    reloadContainerInfo,
    setIsSubmitting,
    setPanelError,
    share,
  } = params;
  setIsSubmitting(true);
  setPanelError(null);
  try {
    const shared = await share();
    if (!shared) {
      setPanelError(failureLabel);
      return;
    }

    await reloadContainerInfo({ optimisticGrant });
  } catch (error) {
    console.error(errorLogLabel, error);
    setPanelError(errorLabel);
  } finally {
    setIsSubmitting(false);
  }
}

export function useExplorerContainerInfoGroupShare(
  params: ExplorerContainerInfoGroupShareParams,
) {
  const {
    canShareContainer,
    containerId,
    draftShareAccessLevel,
    draftShareGroupId,
    draftShareGroupName,
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

      // Without the label the user chose, the SDK cannot bind the share to the
      // signed group name, so a stale or missing picker entry never submits.
      if (!draftShareGroupId || !draftShareGroupName) {
        setPanelError(EXPLORER_LABELS.containerInfoChooseGroupError);
        return;
      }

      await runContainerInfoShare({
        errorLabel: EXPLORER_LABELS.containerInfoShareGenericFailure,
        errorLogLabel: EXPLORER_LABELS.containerInfoShareGenericFailureLog,
        failureLabel: EXPLORER_LABELS.containerInfoShareToGroupFailure,
        optimisticGrant: {
          accessLevel: draftShareAccessLevel,
          subjectId: draftShareGroupId,
          subjectType: "group",
        },
        reloadContainerInfo,
        setIsSubmitting,
        setPanelError,
        share: () =>
          shareWithGroup(
            containerId,
            draftShareGroupId,
            draftShareAccessLevel,
            {
              expectedGroupName: draftShareGroupName,
            },
          ),
      });
    },
    [
      canShareContainer,
      containerId,
      draftShareAccessLevel,
      draftShareGroupName,
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

    await runContainerInfoShare({
      errorLabel: EXPLORER_LABELS.containerInfoShareToPeerFailure,
      errorLogLabel: EXPLORER_LABELS.containerInfoShareToPeerFailureLog,
      failureLabel: EXPLORER_LABELS.containerInfoShareToPeerFailure,
      optimisticGrant: {
        accessLevel: DEFAULT_SHARE_ACCESS_LEVEL,
        subjectId: peerUserId,
        subjectType: "user",
      },
      reloadContainerInfo,
      setIsSubmitting,
      setPanelError,
      share: () => shareWithUser(containerId, peerUserId),
    });
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
