import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ExplorerContainerInfo,
  ExplorerContainerShareAccessLevel,
} from "../../../stores/explorer/containerInfo";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";

type ExplorerContainerInfoGrant = NonNullable<
  ExplorerContainerInfo["remoteInfo"]
>["grants"][number];

type ReloadExplorerContainerInfo = (options?: {
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
  draftShareAccessLevel: ExplorerContainerShareAccessLevel;
  draftShareGroupId: string;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ExplorerContainerShareAccessLevel,
  ) => Promise<boolean>;
}

interface ExplorerContainerInfoPeerShareParams
  extends ExplorerContainerInfoShareParams {
  peerUserId: string | null;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}

function compactPrincipalId(value: string): string {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function principalLabel(
  subjectType: string,
  subjectId: string,
  containerInfo: NonNullable<ExplorerContainerInfo["remoteInfo"]>,
): string {
  if (subjectType === "group") {
    const group = containerInfo.groups.find(
      (candidate) => candidate.groupId === subjectId,
    );
    if (group) {
      return group.name;
    }
  }

  return compactPrincipalId(subjectId);
}

function upsertContainerInfoGrant(
  info: ExplorerContainerInfo,
  grant: ExplorerContainerInfoGrant | null,
): ExplorerContainerInfo {
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

  return {
    ...info,
    remoteInfo: {
      ...info.remoteInfo,
      grants,
    },
  };
}

function getInitialDraftShareGroupId(info: ExplorerContainerInfo): string {
  return (
    info.remoteInfo?.groups.find((group) => group.currentState)?.groupId ?? ""
  );
}

function getNextDraftShareGroupId(
  info: ExplorerContainerInfo,
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

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCurrentContainerInfoRequest(
  isMountedRef: { current: boolean },
  requestIdRef: { current: number },
  requestId: number,
): boolean {
  return isMountedRef.current && requestIdRef.current === requestId;
}

function getReloadedDraftShareGroupId(params: {
  currentGroupId: string;
  info: ExplorerContainerInfo;
  resetDrafts: boolean;
}): string {
  if (params.resetDrafts) {
    return getInitialDraftShareGroupId(params.info);
  }

  return getNextDraftShareGroupId(params.info, params.currentGroupId);
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

function useExplorerContainerInfo(params: {
  containerId: string;
  loadContainerInfo: (containerId: string) => Promise<ExplorerContainerInfo>;
}) {
  const { containerId, loadContainerInfo } = params;
  const [containerInfo, setContainerInfo] =
    useState<ExplorerContainerInfo | null>(null);
  const [containerInfoError, setContainerInfoError] = useState<string | null>(
    null,
  );
  const [draftShareAccessLevel, setDraftShareAccessLevel] =
    useState<ExplorerContainerShareAccessLevel>("write");
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
      requestIdRef.current = requestId;
      setIsLoadingContainerInfo(true);
      setContainerInfoError(null);
      if (options.resetDrafts) {
        setContainerInfo(null);
        setDraftShareGroupId("");
        setDraftShareAccessLevel("write");
        setPanelError(null);
      }

      try {
        const nextInfo = await loadContainerInfo(containerId);
        if (
          !isCurrentContainerInfoRequest(isMountedRef, requestIdRef, requestId)
        ) {
          return;
        }

        const updatedInfo = upsertContainerInfoGrant(
          nextInfo,
          options.optimisticGrant ?? null,
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
        if (
          !isCurrentContainerInfoRequest(isMountedRef, requestIdRef, requestId)
        ) {
          return;
        }

        setContainerInfo(null);
        setContainerInfoError(unknownErrorMessage(error));
      } finally {
        if (
          isCurrentContainerInfoRequest(isMountedRef, requestIdRef, requestId)
        ) {
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

function ExplorerContainerInfoSyncCursorList(params: {
  containerInfo: NonNullable<ExplorerContainerInfo["remoteInfo"]>;
}) {
  const { containerInfo } = params;

  return (
    <table className="explorer-info-table">
      <thead>
        <tr>
          <th>Lane</th>
          <th>Cursor</th>
          <th>Saved</th>
        </tr>
      </thead>
      <tbody>
        {containerInfo.syncCursors.map((cursor) => (
          <tr key={`${cursor.laneKind}:${cursor.laneId}`}>
            <td>
              <div>{cursor.label}</div>
              <code title={`${cursor.laneKind}:${cursor.laneId}`}>
                {cursor.laneKind}/{cursor.laneId}
              </code>
            </td>
            <td>
              {cursor.watermarkUpdatedAt ? (
                <>
                  <div title={cursor.watermarkUpdatedAt}>
                    {formatMiniAppDateTime(cursor.watermarkUpdatedAt)}
                  </div>
                  <code title={cursor.watermarkId ?? undefined}>
                    {cursor.watermarkId
                      ? compactPrincipalId(cursor.watermarkId)
                      : ""}
                  </code>
                </>
              ) : (
                <span className="explorer-info-muted">No local cursor</span>
              )}
            </td>
            <td title={cursor.savedAt ?? undefined}>
              {formatMiniAppDateTime(cursor.savedAt, { emptyFallback: "-" })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExplorerContainerInfoGrantList(params: {
  containerInfo: NonNullable<ExplorerContainerInfo["remoteInfo"]>;
}) {
  const { containerInfo } = params;
  if (containerInfo.grants.length === 0) {
    return <div className="explorer-modal-copy">No grants.</div>;
  }

  return (
    <table className="explorer-info-table">
      <thead>
        <tr>
          <th>Principal</th>
          <th>Type</th>
          <th>Permission</th>
        </tr>
      </thead>
      <tbody>
        {containerInfo.grants.map((grant) => (
          <tr key={`${grant.subjectType}:${grant.subjectId}`}>
            <td title={grant.subjectId}>
              {principalLabel(
                grant.subjectType,
                grant.subjectId,
                containerInfo,
              )}
            </td>
            <td>{grant.subjectType}</td>
            <td>{grant.accessLevel}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExplorerContainerInfoLocalDetails(params: {
  containerId: string;
  containerInfo: ExplorerContainerInfo | null;
}) {
  const { containerId, containerInfo } = params;

  return (
    <table className="explorer-info-table">
      <tbody>
        <tr>
          <th>ID</th>
          <td title={containerId}>{containerId}</td>
        </tr>
        {containerInfo ? (
          <>
            <tr>
              <th>Created</th>
              <td title={containerInfo.local.createdAt ?? undefined}>
                {formatMiniAppDateTime(containerInfo.local.createdAt, {
                  emptyFallback: "-",
                })}
              </td>
            </tr>
            <tr>
              <th>Updated</th>
              <td title={containerInfo.local.updatedAt ?? undefined}>
                {formatMiniAppDateTime(containerInfo.local.updatedAt, {
                  emptyFallback: "-",
                })}
              </td>
            </tr>
          </>
        ) : null}
      </tbody>
    </table>
  );
}

function ExplorerContainerInfoBody(params: {
  containerId: string;
  containerInfo: ExplorerContainerInfo | null;
  containerInfoError: string | null;
  draftShareAccessLevel: ExplorerContainerShareAccessLevel;
  draftShareGroupId: string;
  isLoadingContainerInfo: boolean;
  isSubmitting: boolean;
  onShareWithPeer: () => void;
  peerUserId: string | null;
  setDraftShareAccessLevel: (value: ExplorerContainerShareAccessLevel) => void;
  setDraftShareGroupId: (value: string) => void;
  setPanelError: (error: string | null) => void;
}) {
  const {
    containerId,
    containerInfo,
    containerInfoError,
    draftShareAccessLevel,
    draftShareGroupId,
    isLoadingContainerInfo,
    isSubmitting,
    onShareWithPeer,
    peerUserId,
    setDraftShareAccessLevel,
    setDraftShareGroupId,
    setPanelError,
  } = params;
  const shareableGroups =
    containerInfo?.remoteInfo?.groups.filter((group) => group.currentState) ??
    [];
  const localDetails = (
    <section className="explorer-info-section">
      <h3>Local Details</h3>
      <ExplorerContainerInfoLocalDetails
        containerId={containerId}
        containerInfo={containerInfo}
      />
    </section>
  );

  if (isLoadingContainerInfo && !containerInfo) {
    return (
      <div className="explorer-info">
        {localDetails}
        <div className="explorer-modal-copy">Loading...</div>
      </div>
    );
  }

  if (containerInfoError) {
    return (
      <div className="explorer-info">
        {localDetails}
        <div className="explorer-modal-error">{containerInfoError}</div>
      </div>
    );
  }

  if (!containerInfo) {
    return <div className="explorer-info">{localDetails}</div>;
  }

  return (
    <div className="explorer-info">
      {localDetails}
      {containerInfo.remoteInfo ? (
        <>
          <section className="explorer-info-section">
            <h3>Principal Grants</h3>
            <ExplorerContainerInfoGrantList
              containerInfo={containerInfo.remoteInfo}
            />
          </section>
          <section className="explorer-info-section">
            <h3>Sync Cursors</h3>
            <ExplorerContainerInfoSyncCursorList
              containerInfo={containerInfo.remoteInfo}
            />
          </section>
          <section className="explorer-info-section">
            <h3>Share To Group</h3>
            <label className="explorer-modal-field">
              Group
              <select
                aria-label="Group"
                disabled={isSubmitting || shareableGroups.length === 0}
                value={draftShareGroupId}
                onChange={(event) => {
                  setPanelError(null);
                  setDraftShareGroupId(event.target.value);
                }}
              >
                {shareableGroups.length === 0 ? (
                  <option value="">No groups</option>
                ) : (
                  shareableGroups.map((group) => (
                    <option key={group.groupId} value={group.groupId}>
                      {group.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="explorer-modal-field">
              Permission
              <select
                aria-label="Permission"
                disabled={isSubmitting || shareableGroups.length === 0}
                value={draftShareAccessLevel}
                onChange={(event) => {
                  setPanelError(null);
                  setDraftShareAccessLevel(
                    event.target.value as ExplorerContainerShareAccessLevel,
                  );
                }}
              >
                <option value="read">read</option>
                <option value="write">write</option>
                <option value="admin">admin</option>
              </select>
            </label>
          </section>
          {peerUserId ? (
            <section className="explorer-info-section">
              <h3>Share To Peer</h3>
              <button
                className="explorer-info-inline-action"
                disabled={isSubmitting}
                type="button"
                onClick={onShareWithPeer}
              >
                Share With Peer
              </button>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function useExplorerContainerInfoGroupShare(
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
        setPanelError("Choose a group.");
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
          setPanelError("Failed to share container with group.");
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
        console.error("Failed to share container:", error);
        setPanelError("Failed to share container.");
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

function useExplorerContainerInfoPeerShare(
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
        setPanelError("Failed to share container with peer.");
        return;
      }

      await reloadContainerInfo({
        optimisticGrant: {
          accessLevel: "write",
          subjectId: peerUserId,
          subjectType: "user",
        },
      });
    } catch (error) {
      console.error("Failed to share container with peer:", error);
      setPanelError("Failed to share container with peer.");
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

function ExplorerContainerInfoHeader(params: {
  containerId: string;
  containerName: string | undefined;
  isSubmitting: boolean;
  onBackToContainer: () => void;
}) {
  const { containerId, containerName, isSubmitting, onBackToContainer } =
    params;
  return (
    <div className="explorer-detail-header">
      <div className="explorer-detail-copy">
        <strong>Container Info</strong>
        <span>{containerName ?? compactPrincipalId(containerId)}</span>
      </div>
      <div className="explorer-detail-actions">
        <button
          type="button"
          className="explorer-action-button"
          disabled={isSubmitting}
          onClick={onBackToContainer}
        >
          Back to Container
        </button>
      </div>
    </div>
  );
}

function ExplorerContainerInfoActions(params: {
  draftShareGroupId: string;
  isLoadingContainerInfo: boolean;
  isSubmitting: boolean;
  showShareButton: boolean;
}) {
  const {
    draftShareGroupId,
    isLoadingContainerInfo,
    isSubmitting,
    showShareButton,
  } = params;
  if (!showShareButton) {
    return null;
  }

  return (
    <div className="explorer-modal-actions">
      <button
        type="submit"
        disabled={isSubmitting || isLoadingContainerInfo || !draftShareGroupId}
      >
        {isSubmitting ? "Sharing..." : "Share"}
      </button>
    </div>
  );
}

export function ExplorerContainerInfoPanel(params: {
  containerId: string;
  containerName: string | undefined;
  loadContainerInfo: (containerId: string) => Promise<ExplorerContainerInfo>;
  onBackToContainer: () => void;
  peerUserId: string | null;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ExplorerContainerShareAccessLevel,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}) {
  const {
    containerId,
    containerName,
    loadContainerInfo,
    onBackToContainer,
    peerUserId,
    shareWithGroup,
    shareWithUser,
  } = params;
  const {
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
  } = useExplorerContainerInfo({ containerId, loadContainerInfo });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleShareWithGroup = useExplorerContainerInfoGroupShare({
    containerId,
    draftShareAccessLevel,
    draftShareGroupId,
    isSubmitting,
    reloadContainerInfo,
    setIsSubmitting,
    setPanelError,
    shareWithGroup,
  });
  const handleShareWithPeer = useExplorerContainerInfoPeerShare({
    containerId,
    isSubmitting,
    peerUserId,
    reloadContainerInfo,
    setIsSubmitting,
    setPanelError,
    shareWithUser,
  });

  const showShareButton = Boolean(containerInfo?.remoteInfo);

  return (
    <form
      className="explorer-detail explorer-detail--container-info"
      key={containerId}
      onSubmit={handleShareWithGroup}
    >
      <ExplorerContainerInfoHeader
        containerId={containerId}
        containerName={containerName}
        isSubmitting={isSubmitting}
        onBackToContainer={onBackToContainer}
      />
      <ExplorerContainerInfoBody
        containerId={containerId}
        containerInfo={containerInfo}
        containerInfoError={containerInfoError}
        draftShareAccessLevel={draftShareAccessLevel}
        draftShareGroupId={draftShareGroupId}
        isLoadingContainerInfo={isLoadingContainerInfo}
        isSubmitting={isSubmitting}
        onShareWithPeer={handleShareWithPeer}
        peerUserId={peerUserId}
        setDraftShareAccessLevel={setDraftShareAccessLevel}
        setDraftShareGroupId={setDraftShareGroupId}
        setPanelError={setPanelError}
      />
      {panelError ? (
        <div className="explorer-modal-error">{panelError}</div>
      ) : null}
      <ExplorerContainerInfoActions
        draftShareGroupId={draftShareGroupId}
        isLoadingContainerInfo={isLoadingContainerInfo}
        isSubmitting={isSubmitting}
        showShareButton={showShareButton}
      />
    </form>
  );
}
